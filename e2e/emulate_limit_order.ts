// $ deno run -A emulate_limit_order.ts
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

// Load the limit order smart contract

const fullLimitOrderValidator = JSON.parse(await Deno.readTextFile("plutus.json")).validators.find(
  (v) => v.title === "limit_order.full_limit_order"
);

const fullLimitOrderScript: SpendingValidator = {
  type: "PlutusV2",
  script: fullLimitOrderValidator.compiledCode,
};

const fullLimitOrderAddress: Address = lucid.utils.validatorToAddress(
  fullLimitOrderScript,
);

// Define nicknames for known addresses
const knownAddresses = new Map()
knownAddresses.set(aliceAddress, "Alice")
knownAddresses.set(bobAddress, "Bob")
knownAddresses.set(alwaysMintAddress, "MintContract")
knownAddresses.set(fullLimitOrderAddress, "FullLimitOrderContract")

// Helper function to submit a transaction
async function sendTx(tx): Promise<TxHash> {
  const signedTx = await tx.sign().complete();
  return await signedTx.submit();
}

// #############################################################################
// Alice mints 100 PIZADA token

lucid.selectWalletFromPrivateKey(privateKeyAlice)
let tx = await lucid.newTx()
  .mintAssets({[unit]: 100n}, Data.void())
  .attachMintingPolicy(alwaysMintScript)
  .complete();
await sendTx(tx);
emulator.awaitBlock(4)

// #############################################################################
// Build the Datum schema

const AssetSchema = Data.Tuple([Data.Bytes(), Data.Bytes(), Data.Integer()])
const OutputRefSchema = Data.Object({
  transaction_id: Data.Object({hash: Data.Bytes()}),
  output_index: Data.Integer(),
})
const DatumSchema = Data.Object({
  owner: Data.Bytes(),
  sell: AssetSchema,
  buy: AssetSchema,
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
// Alice places limit order to sell 42 PIZADA for 420 ADA

const aliceHash = lucid.utils.getAddressDetails(aliceAddress)
  .paymentCredential?.hash;

const aliceDatum: Datum = {
  owner: aliceHash!,
  sell: [policyId, fromText("PIZADA"), 42n],
  buy: ["", "", 420_000000n],
}

lucid.selectWalletFromPrivateKey(privateKeyAlice)
tx = await lucid.newTx()
  .payToContract(fullLimitOrderAddress, {inline: Data.to(aliceDatum, Datum)}, {[unit]: 42n})
  .complete({coinSelection: true})
console.log("Send 42 PIZADA to the limit order contract:")
console.log(await txRecord(tx, lucid, knownAddresses))
await sendTx(tx);
emulator.awaitBlock(4)

// #############################################################################
// Bob swaps 420 ADA for 42 PIZADA

console.log("UTxOs in the limit order smart contract:");
const orderUtxos = await lucid.utxosAt(fullLimitOrderAddress)
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
const limitOrderInputIndex = inputUtxos.findIndex((u) => u === orderUtxos[0])
console.log("limitOrderInputIndex:", limitOrderInputIndex)

const bobRedeemer: Redeemer = {
  index_input: BigInt(limitOrderInputIndex),
  index_output: 0n, // The returned UTxO should be the first output
}

// 420 ADA for 42 PIZADA
const returnedValues = {
  lovelace: orderUtxos[0].assets.lovelace + 420_000000n,
  [unit]: orderUtxos[0].assets[unit] - 42n,
}


try {
  lucid.selectWalletFromPrivateKey(privateKeyBob)
  tx = await lucid.newTx()
    .collectFrom([orderUtxos[0]], Data.to(bobRedeemer, Redeemer))
    .attachSpendingValidator(fullLimitOrderScript)
    .payToAddressWithData(aliceAddress, {inline: Data.to(prevUtxoRef, OutputRefDatum)}, returnedValues)
    .collectFrom([bobUtxos[0]])
    .complete({coinSelection: false})
  console.log("Bob swaps 420 ADA for 42 PIZADA:")
  console.log(await txRecord(tx, lucid, knownAddresses))
  await sendTx(tx);
  emulator.awaitBlock(4)
} catch (error) {
  console.log("Failed with error:")
  console.log(error)
  throw new Error("You can do it!")
}