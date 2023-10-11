// $ deno run -A emulate_sliding_order.ts
import {
  Address,
  Data,
  Emulator,
  generatePrivateKey,
  Lucid,
  TxHash,
  fromText,
  MintingPolicy,
  SpendingValidator,
} from "https://deno.land/x/lucid@0.10.7/mod.ts";

import { txRecord } from "./utils.ts";

// Define wallets, balances and Custom network

const privateKeyAlice = generatePrivateKey();
const privateKeyBob = generatePrivateKey();

const aliceAddress = await (await Lucid.new(undefined, "Custom"))
  .selectWalletFromPrivateKey(privateKeyAlice).wallet.address();

const bobAddress = await (await Lucid.new(undefined, "Custom"))
  .selectWalletFromPrivateKey(privateKeyBob).wallet.address();

const emulator = new Emulator([{
  address: aliceAddress,
  assets: { lovelace: 2000_000000n },
}, {
  address: bobAddress,
  assets: { lovelace: 3000_000000n },
}]);
const lucid = await Lucid.new(emulator);

// Load the minting smart contracts

const alwaysMintValidator = JSON.parse(await Deno.readTextFile("plutus.json")).validators.find(
  (v) => v.title === "mint.always_mint"
);

const alwaysMintScript: MintingPolicy = {
  type: "PlutusV2",
  script: alwaysMintValidator.compiledCode,
};

const alwaysMintAddress: Address = lucid.utils.validatorToAddress(
  alwaysMintScript,
);

const policyId = lucid.utils.mintingPolicyToId(alwaysMintScript);
const unit = policyId + fromText("PIZADA");

// Load the sliding order smart contract

const slidingOrderValidator = JSON.parse(await Deno.readTextFile("plutus.json")).validators.find(
  (v) => v.title === "sliding_order.sliding_order"
);

const slidingOrderScript: SpendingValidator = {
  type: "PlutusV2",
  script: slidingOrderValidator.compiledCode,
};

const slidingOrderAddress: Address = lucid.utils.validatorToAddress(
  slidingOrderScript,
);

// Define nicknames for known addresses
const knownAddresses = new Map()
knownAddresses.set(aliceAddress, "Alice")
knownAddresses.set(bobAddress, "Bob")
knownAddresses.set(alwaysMintAddress, "MintContract")
knownAddresses.set(slidingOrderAddress, "SlidingOrderContract")

// Helper function to submit a transaction
async function sendTx(tx): Promise<TxHash> {
  const signedTx = await tx.sign().complete();
  return await signedTx.submit();
}

// #############################################################################
// Alice mints 100 PIZADA token

console.log("Emulator start time:", emulator.time)
lucid.selectWalletFromPrivateKey(privateKeyAlice)
let tx = await lucid.newTx()
  .mintAssets({[unit]: 100n}, Data.void())
  .attachMintingPolicy(alwaysMintScript)
  .complete();
await sendTx(tx);
emulator.awaitBlock(4)
console.log("Emulator time after Alice mints:", emulator.time)

// #############################################################################
// Build the Datum schema

const AssetSchema = Data.Tuple([Data.Bytes(), Data.Bytes()])
const OutputRefSchema = Data.Object({
  transaction_id: Data.Object({hash: Data.Bytes()}),
  output_index: Data.Integer(),
})
const DatumSchema = Data.Object({
  owner: Data.Bytes(),
  sell_asset: AssetSchema,
  buy_asset: AssetSchema,
  sell_amount: Data.Integer(),
  buy_amount_start: Data.Integer(),
  buy_amount_slope_per_ms: Data.Tuple([Data.Integer(), Data.Integer()]),
  start_time: Data.Integer(),
})

type Datum = Data.Static<typeof DatumSchema>
const Datum = DatumSchema as unknown as Datum

type OutputRefDatum = Data.Static<typeof OutputRefSchema>
const OutputRefDatum = OutputRefSchema as unknown as OutputRefDatum

// #############################################################################
// Build the Redeemer schema

const RedeemerSchema = Data.Object({
  index_input: Data.Integer(),
  index_output: Data.Integer(),
})

type Redeemer = Data.Static<typeof RedeemerSchema>
const Redeemer = RedeemerSchema as unknown as Redeemer

// #############################################################################
// Alice places limit order to sell 42 PIZADA for 420 ADA, which decreases of 1 ADA per second

const aliceHash = lucid.utils.getAddressDetails(aliceAddress)
  .paymentCredential?.hash;

const aliceDatum: Datum = {
  owner: aliceHash!,
  sell_asset: [policyId, fromText("PIZADA")],
  buy_asset: ["", ""],
  sell_amount: 42n,
  buy_amount_start: 420_000000n,
  buy_amount_slope_per_ms: [-1_000000n, 1000n], // -1 ADA / 1000 ms
  start_time: BigInt(emulator.time), // check current simulator time
}

console.log("Emulator time before Alice places order:", emulator.time)
lucid.selectWalletFromPrivateKey(privateKeyAlice)
tx = await lucid.newTx()
  .payToContract(slidingOrderAddress, {inline: Data.to(aliceDatum, Datum)}, {[unit]: 42n})
  .complete({coinSelection: true})
console.log("Send 42 PIZADA to the sliding order contract:")
console.log(await txRecord(tx, lucid, knownAddresses))
await sendTx(tx);
emulator.awaitBlock(1) // 1 block is 20s by default in the emulator
console.log("Emulator time after Alice places order:", emulator.time)

// #############################################################################
// Bob buys he 42 PIZADA for only 410 ADA instead of 420 ADA.
// He waits for 1 block (20 seconds) so that would be 400 ADA.
// But he also uses a valid time range of 10 seconds, so we get a final price of 410 ADA.

console.log("UTxOs in the limit order smart contract:");
const orderUtxos = await lucid.utxosAt(slidingOrderAddress)
console.log(orderUtxos);
const prevUtxoRef = {
  transaction_id: {hash: orderUtxos[0].txHash},
  output_index: BigInt(orderUtxos[0].outputIndex),
};

console.log("Bob UTxOs:");
const bobUtxos = await lucid.utxosAt(bobAddress)
console.log(bobUtxos)


// Figure out at which index will be the limit order utxo.
// Input utxo are sorted in a transaction so let's sort all the input utxos.
const inputUtxos = [orderUtxos[0], bobUtxos[0]]
inputUtxos.sort((utxo1, utxo2) => 
  utxo1.txHash.localeCompare(utxo2.txHash) + (utxo1.outputIndex - utxo2.outputIndex) / inputUtxos.length
)
const slidingOrderInputIndex = inputUtxos.findIndex((u) => u === orderUtxos[0])
console.log("slidingOrderInputIndex:", slidingOrderInputIndex)

const bobRedeemer = {
  index_input: BigInt(slidingOrderInputIndex),
  index_output: 0n, // The returned UTxO should be the first output
}

// 42 PIZADA for only 410 ADA instead of 420 ADA
// since he waits for 1 block (20 seconds = -20ada)
// and uses a valid time range of 10s (= +10ada)
const returnedValues = {
  lovelace: orderUtxos[0].assets.lovelace + 410_000000n,
  [unit]: orderUtxos[0].assets[unit] - 42n,
}


try {
  lucid.selectWalletFromPrivateKey(privateKeyBob)
  tx = await lucid.newTx()
    .collectFrom([orderUtxos[0]], Data.to(bobRedeemer, Redeemer))
    .attachSpendingValidator(slidingOrderScript)
    .payToAddressWithData(aliceAddress, {inline: Data.to(prevUtxoRef, OutputRefDatum)}, returnedValues)
    .collectFrom([bobUtxos[0]])
    .validFrom(emulator.time)
    .validTo(emulator.time + 10_000)
    .complete({coinSelection: false})
  console.log("Bob buys 42 PIZADA with 410 ADA:")
  console.log(await txRecord(tx, lucid, knownAddresses))
  await sendTx(tx);
  emulator.awaitBlock(4)
} catch (error) {
  console.log("Failed with error:")
  console.log(error)
  throw new Error("You can do it!")
}