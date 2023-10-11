// $ deno run -A emulate_grid_order.ts
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

// Load the grid order smart contract

const gridOrderValidator = JSON.parse(await Deno.readTextFile("plutus.json")).validators.find(
  (v) => v.title === "grid_order.grid_order"
);

const gridOrderScript: SpendingValidator = {
  type: "PlutusV2",
  script: gridOrderValidator.compiledCode,
};

const gridOrderAddress: Address = lucid.utils.validatorToAddress(
  gridOrderScript,
);

// Define nicknames for known addresses
const knownAddresses = new Map()
knownAddresses.set(aliceAddress, "Alice")
knownAddresses.set(bobAddress, "Bob")
knownAddresses.set(alwaysMintAddress, "MintContract")
knownAddresses.set(gridOrderAddress, "GridOrderContract")

// Helper function to submit a transaction
async function sendTx(tx): Promise<TxHash> {
  const signedTx = await tx.sign().complete();
  return await signedTx.submit();
}

// #############################################################################
// Alice & Bob mint 100 PIZADA token

lucid.selectWalletFromPrivateKey(privateKeyAlice)
let tx = await lucid.newTx()
  .mintAssets({[unit]: 100n}, Data.void())
  .attachMintingPolicy(alwaysMintScript)
  .complete();
await sendTx(tx);
emulator.awaitBlock(4)

lucid.selectWalletFromPrivateKey(privateKeyBob)
tx = await lucid.newTx()
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
  grid_id: Data.Integer(),
  asset_1: AssetSchema,
  asset_2: AssetSchema,
  ratio_buy_1: Data.Tuple([Data.Integer(), Data.Integer()]),
  ratio_sell_1: Data.Tuple([Data.Integer(), Data.Integer()]),
  hold_1: Data.Boolean(),
  from_utxo: Data.Nullable(OutputRefSchema),
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
// Alice places a grid order to buy PIZADA at 1 ADA and sell at 2ADA

const aliceHash = lucid.utils.getAddressDetails(aliceAddress)
  .paymentCredential?.hash;

// Rmq: I've placed ADA in asset_1 just to try. It's more logical to put ADA in asset_2.
const aliceDatum: Datum = {
  owner: aliceHash!,
  grid_id: 0n,
  asset_1: ["", ""],
  asset_2: [policyId, fromText("PIZADA")],
  ratio_buy_1: [2000000n, 1n],
  ratio_sell_1: [1000000n, 1n],
  hold_1: false,
  from_utxo: null,
}

lucid.selectWalletFromPrivateKey(privateKeyAlice)
tx = await lucid.newTx()
  .payToContract(gridOrderAddress, {inline: Data.to(aliceDatum, Datum)}, {[unit]: 42n})
  .complete({coinSelection: true})
console.log("Send 42 PIZADA to the grid order contract:")
console.log(await txRecord(tx, lucid, knownAddresses))
await sendTx(tx);
emulator.awaitBlock(4)

// #############################################################################
// Bob buys the 42 PIZADA with 84 ADA

console.log("UTxOs in the grid order smart contract:");
let orderUtxos = await lucid.utxosAt(gridOrderAddress)
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
let inputUtxos = [orderUtxos[0], bobUtxos[1]]
inputUtxos.sort((utxo1, utxo2) => 
  utxo1.txHash.localeCompare(utxo2.txHash) + (utxo1.outputIndex - utxo2.outputIndex) / inputUtxos.length
)
let gridOrderInputIndex = inputUtxos.findIndex((u) => u === orderUtxos[0])
console.log("gridOrderInputIndex:", gridOrderInputIndex)

// Prepare Bob's datum and redeemer for the swap // buy 42 PIZADA with 84 ADA
let new_lovelace_amount = orderUtxos[0].assets.lovelace + 84_000000n
let new_pizada_amount = orderUtxos[0].assets[unit] - 42n

let returnedValues = {
  lovelace: new_lovelace_amount,
  [unit]: new_pizada_amount,
}
console.log("returned values:", returnedValues)

let bobDatum: Datum = {
  owner: aliceHash!,
  grid_id: 0n,
  asset_1: ["", ""],
  asset_2: [policyId, fromText("PIZADA")],
  ratio_buy_1: [2000000n, 1n],
  ratio_sell_1: [1000000n, 1n],
  hold_1: !aliceDatum.hold_1,
  from_utxo: prevUtxoRef,
}

let bobRedeemer: Redeemer = {
  index_input: BigInt(gridOrderInputIndex),
  index_output: 0n, // The returned UTxO should be the first output
}

try {
  lucid.selectWalletFromPrivateKey(privateKeyBob)
  tx = await lucid.newTx()
    .collectFrom([orderUtxos[0]], Data.to(bobRedeemer, Redeemer))
    .attachSpendingValidator(gridOrderScript)
    .payToContract(gridOrderAddress, {inline: Data.to(bobDatum, Datum)}, returnedValues)
    .collectFrom([bobUtxos[1]])
    .complete({coinSelection: false})
  console.log("Bob buys the 42 PIZADA with 84 ADA:")
  console.log(await txRecord(tx, lucid, knownAddresses))
  await sendTx(tx);
  emulator.awaitBlock(4)
} catch (error) {
  console.log("Failed with error:")
  console.log(error)
  throw new Error("You can do it!")
}

// #############################################################################
// Bob sells his PIZADA for ADA

console.log("UTxOs in the grid order smart contract:");
orderUtxos = await lucid.utxosAt(gridOrderAddress)
console.log(orderUtxos);
prevUtxoRef = {
  transaction_id: {hash: orderUtxos[0].txHash},
  output_index: BigInt(orderUtxos[0].outputIndex),
};

console.log("Bob UTxOs:");
bobUtxos = await lucid.utxosAt(bobAddress)
console.log(bobUtxos)

// Figure out at which index will be the limit order utxo.
// Input utxo are sorted in a transaction so let's sort all the input utxos.
inputUtxos = [orderUtxos[0], bobUtxos[0], bobUtxos[2]]
inputUtxos.sort((utxo1, utxo2) => 
  utxo1.txHash.localeCompare(utxo2.txHash) + (utxo1.outputIndex - utxo2.outputIndex) / inputUtxos.length
)
gridOrderInputIndex = inputUtxos.findIndex((u) => u === orderUtxos[0])
console.log("gridOrderInputIndex:", gridOrderInputIndex)

// Prepare Bob's datum and redeemer for the swap // sell at price ratio 1 for 1
new_lovelace_amount = orderUtxos[0].assets.lovelace - 84_000000n
new_pizada_amount = orderUtxos[0].assets[unit] + 84n

returnedValues = {
  lovelace: new_lovelace_amount,
  [unit]: new_pizada_amount,
}
console.log("returned values:", returnedValues)

bobDatum = {
  owner: aliceHash!,
  grid_id: 0n,
  asset_1: ["", ""],
  asset_2: [policyId, fromText("PIZADA")],
  ratio_buy_1: [2000000n, 1n],
  ratio_sell_1: [1000000n, 1n],
  hold_1: !bobDatum.hold_1,
  from_utxo: prevUtxoRef,
}

bobRedeemer = {
  index_input: BigInt(gridOrderInputIndex),
  index_output: 0n, // The returned UTxO should be the first output
}

try {
  lucid.selectWalletFromPrivateKey(privateKeyBob)
  tx = await lucid.newTx()
    .collectFrom([orderUtxos[0]], Data.to(bobRedeemer, Redeemer))
    .attachSpendingValidator(gridOrderScript)
    .payToContract(gridOrderAddress, {inline: Data.to(bobDatum, Datum)}, returnedValues)
    .collectFrom([bobUtxos[0]])
    .collectFrom([bobUtxos[2]])
    .complete({coinSelection: false})
  console.log("Bob sell PIZADA for ADA:")
  console.log(await txRecord(tx, lucid, knownAddresses))
  await sendTx(tx);
  emulator.awaitBlock(4)
} catch (error) {
  console.log("Failed with error:")
  console.log(error)
  throw new Error("You can do it!")
}
