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

const limitOrderValidator = JSON.parse(await Deno.readTextFile("plutus.json")).validators.find(
  (v) => v.title === "limit_order.limit_order"
);

const limitOrderScript: SpendingValidator = {
  type: "PlutusV2",
  script: limitOrderValidator.compiledCode,
};

const limitOrderAddress: Address = lucid.utils.validatorToAddress(
  limitOrderScript,
);

// Define nicknames for known addresses
const knownAddresses = new Map()
knownAddresses.set(aliceAddress, "Alice")
knownAddresses.set(bobAddress, "Bob")
knownAddresses.set(alwaysMintAddress, "MintContract")
knownAddresses.set(limitOrderAddress, "LimitOrderContract")

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
  buy_amount: Data.Integer(),
  from_utxo: Data.Nullable(OutputRefSchema),
})

type Datum = Data.Static<typeof DatumSchema>
const Datum = DatumSchema as unknown as Datum

type OutputRefDatum = Data.Static<typeof OutputRefSchema>
const OutputRefDatum = OutputRefSchema as unknown as OutputRefDatum

// #############################################################################
// Build the Redeemer schema

const RedeemerSchema = Data.Object({
  partial: Data.Boolean(),
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
  sell_asset: [policyId, fromText("PIZADA")],
  buy_asset: ["", ""],
  sell_amount: 42n,
  buy_amount: 420_000000n,
  from_utxo: null,
}

lucid.selectWalletFromPrivateKey(privateKeyAlice)
tx = await lucid.newTx()
  .payToContract(limitOrderAddress, {inline: Data.to(aliceDatum, Datum)}, {[unit]: 42n})
  .complete({coinSelection: true})
console.log("Send 42 PIZADA to the limit order contract:")
console.log(await txRecord(tx, lucid, knownAddresses))
await sendTx(tx);
emulator.awaitBlock(4)

// #############################################################################
// Bob does a partial swap of 200 ADA for 20 PIZADA

console.log("UTxOs in the limit order smart contract:");
let orderUtxos = await lucid.utxosAt(limitOrderAddress)
console.log(orderUtxos);
let prevUtxoRef = {
  transaction_id: {hash: orderUtxos[0].txHash},
  output_index: BigInt(orderUtxos[0].outputIndex),
};

console.log("Bob UTxOs:");
let bobUtxos = await lucid.utxosAt(bobAddress)
console.log(bobUtxos)

// Figure out at which index will be the limit order utxo.
// Input utxo are sorted in a transaction so let's sort all the input utxos.
let inputUtxos = [orderUtxos[0], bobUtxos[0]]
inputUtxos.sort((utxo1, utxo2) => 
  utxo1.txHash.localeCompare(utxo2.txHash) + (utxo1.outputIndex - utxo2.outputIndex) / inputUtxos.length
)
let limitOrderInputIndex = inputUtxos.findIndex((u) => u === orderUtxos[0])
console.log("limitOrderInputIndex:", limitOrderInputIndex)

// Prepare Bob's datum and redeemer for the partial order // 200 ADA for 20 PIZADA
const new_lovelace_amount = orderUtxos[0].assets.lovelace + 200_000000n
const new_pizada_amount = orderUtxos[0].assets[unit] - 20n

const bobDatum: Datum = {
  owner: aliceHash!,
  sell_asset: [policyId, fromText("PIZADA")],
  buy_asset: ["", ""],
  sell_amount: aliceDatum.sell_amount - 20n,
  buy_amount: aliceDatum.buy_amount - 200_000000n,
  from_utxo: prevUtxoRef,
}

let bobRedeemer: Redeemer = {
  partial: true,
  index_input: BigInt(limitOrderInputIndex),
  index_output: 0n, // The returned UTxO should be the first output
}

let returnedValues = {
  lovelace: new_lovelace_amount,
  [unit]: new_pizada_amount,
}
console.log("returned values:", returnedValues)

try {
  lucid.selectWalletFromPrivateKey(privateKeyBob)
  tx = await lucid.newTx()
    .collectFrom([orderUtxos[0]], Data.to(bobRedeemer, Redeemer))
    .attachSpendingValidator(limitOrderScript)
    .payToContract(limitOrderAddress, {inline: Data.to(bobDatum, Datum)}, returnedValues)
    .collectFrom([bobUtxos[0]])
    .complete({coinSelection: false})
  console.log("Bob partial swaps 200 ADA for 20 PIZADA:")
  console.log(await txRecord(tx, lucid, knownAddresses))
  await sendTx(tx);
  emulator.awaitBlock(4)
} catch (error) {
  console.log("Failed with error:")
  console.log(error)
  throw new Error("You can do it!")
}

// #############################################################################
// Bob swaps the rest of the previous partial order (220 ADA for 22 PIZADA)

console.log("UTxOs in the limit order smart contract:");
orderUtxos = await lucid.utxosAt(limitOrderAddress)
console.log(orderUtxos);
prevUtxoRef = {
  transaction_id: {hash: orderUtxos[0].txHash},
  output_index: BigInt(orderUtxos[0].outputIndex),
};

// This time, it's probably the second utxo of Bob and not the first that we want
// as the first contains barely enough ada to hold the just bought pizada.
console.log("Bob UTxOs:");
bobUtxos = await lucid.utxosAt(bobAddress)
console.log(bobUtxos)


// Figure out at which index will be the limit order utxo.
// Input utxo are sorted in a transaction so let's sort all the input utxos.
inputUtxos = [orderUtxos[0], bobUtxos[1]]
inputUtxos.sort((utxo1, utxo2) => 
  utxo1.txHash.localeCompare(utxo2.txHash) + (utxo1.outputIndex - utxo2.outputIndex) / inputUtxos.length
)
limitOrderInputIndex = inputUtxos.findIndex((u) => u === orderUtxos[0])
console.log("limitOrderInputIndex:", limitOrderInputIndex)

bobRedeemer = {
  partial: false,
  index_input: BigInt(limitOrderInputIndex),
  index_output: 0n, // The returned UTxO should be the first output
}

// 220 ADA for 22 PIZADA
returnedValues = {
  lovelace: orderUtxos[0].assets.lovelace + 220_000000n,
  [unit]: orderUtxos[0].assets[unit] - 22n,
}


try {
  lucid.selectWalletFromPrivateKey(privateKeyBob)
  tx = await lucid.newTx()
    .collectFrom([orderUtxos[0]], Data.to(bobRedeemer, Redeemer))
    .attachSpendingValidator(limitOrderScript)
    .payToAddressWithData(aliceAddress, {inline: Data.to(prevUtxoRef, OutputRefDatum)}, returnedValues)
    .collectFrom([bobUtxos[1]])
    .complete({coinSelection: false})
  console.log("Bob swaps the rest (220 ADA for 22 PIZADA):")
  console.log(await txRecord(tx, lucid, knownAddresses))
  await sendTx(tx);
  emulator.awaitBlock(4)
} catch (error) {
  console.log("Failed with error:")
  console.log(error)
  throw new Error("You can do it!")
}