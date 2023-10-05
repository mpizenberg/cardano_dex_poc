// $ deno run -A emulate_vault.ts
import {
  Address,
  Data,
  Emulator,
  generatePrivateKey,
  Lucid,
  TxHash,
  Constr,
  fromText,
  applyParamsToScript,
  applyDoubleCborEncoding,
  MintingPolicy,
  PolicyId,
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

// Load the liquidity bin smart contract

const liquidityBinValidator = JSON.parse(await Deno.readTextFile("plutus.json")).validators.find(
  (v) => v.title === "swap.liquidity_bin"
);

const liquidityBinScript: SpendingValidator = {
  type: "PlutusV2",
  script: liquidityBinValidator.compiledCode,
};

const liquidityBinAddress: Address = lucid.utils.validatorToAddress(
  liquidityBinScript,
);

// Define nicknames for known addresses
const knownAddresses = new Map()
knownAddresses.set(aliceAddress, "Alice")
knownAddresses.set(bobAddress, "Bob")
knownAddresses.set(alwaysMintAddress, "MintContract")
knownAddresses.set(liquidityBinAddress, "SwapContract")

// Helper function to submit a transaction
async function sendTx(tx): Promise<TxHash> {
  const signedTx = await tx.sign().complete();
  return await signedTx.submit();
}

// #############################################################################
// Alice mints some the PIZADA token

// Alice mints 100 PIZADA.
lucid.selectWalletFromPrivateKey(privateKeyAlice)
let tx = await lucid.newTx()
  .mintAssets({[unit]: 100n}, Data.void())
  .attachMintingPolicy(alwaysMintScript)
  .complete();
await sendTx(tx);
emulator.awaitBlock(4)

// #############################################################################
// Build the Datum schema

const swapItemSchema = Data.Tuple([Data.Bytes(), Data.Bytes(), Data.Integer()])
const outputRefSchema = Data.Object({
  transaction_id: Data.Object({hash: Data.Bytes()}),
  output_index: Data.Integer(),
})
const DatumSchema = Data.Object({
  owner: Data.Bytes(),
  swap_rate: Data.Tuple([swapItemSchema, swapItemSchema]),
  from_utxo: Data.Nullable(outputRefSchema),
})

type Datum = Data.Static<typeof DatumSchema>
const Datum = DatumSchema as unknown as Datum

// #############################################################################
// Build the Redeemer schema

const RedeemerSchema = Data.Object({
  index_input: Data.Integer(),
  index_output: Data.Integer(),
})

type Redeemer = Data.Static<typeof RedeemerSchema>
const Redeemer = RedeemerSchema as unknown as Redeemer

// #############################################################################
// Alice deposits 42 PIZADA in liquidity at the price 1 PIZADA = 100 ADA

const aliceHash = lucid.utils.getAddressDetails(aliceAddress)
  .paymentCredential?.hash;

const aliceDatum: Datum = {
  owner: aliceHash!,
  swap_rate: [["", "", 100n], [policyId, fromText("PIZADA"), 1n]], // 1 PIZADA = 100 ADA
  from_utxo: null,
}

lucid.selectWalletFromPrivateKey(privateKeyAlice)
tx = await lucid.newTx()
  .payToContract(liquidityBinAddress, {inline: Data.to(aliceDatum, Datum)}, {[unit]: 42n})
  .complete({coinSelection: true})
console.log("Send 42 PIZADA to the liquidity contract:")
console.log(await txRecord(tx, lucid, knownAddresses))
await sendTx(tx);
emulator.awaitBlock(4)

// #############################################################################
// Bob swaps 1000 ADA for 10 PIZADA

console.log("UTxOs in the liquidity bin smart contract:");
const binUtxos = await lucid.utxosAt(liquidityBinAddress)
console.log(binUtxos);
const prevUtxoRef = {
  transaction_id: {hash: binUtxos[0].txHash},
  output_index: BigInt(binUtxos[0].outputIndex),
};

console.log("Bob UTxOs:");
const bobUtxos = await lucid.utxosAt(bobAddress)
console.log(bobUtxos)

const bobDatum: Datum = {
  owner: aliceHash!,
  swap_rate: [["", "", 100n], [policyId, fromText("PIZADA"), 1n]], // 1 PIZADA = 100 ADA
  from_utxo: prevUtxoRef, // Link to previous liquidity bin
}

// Figure out at which index will be the liquidity bin utxo.
// Input utxo are sorted in a transaction so let's sort all the input utxos.
const inputUtxos = [binUtxos[0], bobUtxos[0]]
inputUtxos.sort((utxo1, utxo2) => 
  utxo1.txHash.localeCompare(utxo2.txHash) + (utxo1.outputIndex - utxo2.outputIndex) / inputUtxos.length
)
const binInputIndex = inputUtxos.findIndex((u) => u === binUtxos[0])
console.log("binInputIndex:", binInputIndex)

const bobRedeemer: Redeemer = {
  index_input: BigInt(binInputIndex),
  index_output: 0n, // The returned UTxO to the bin should be the first output
}

const newBinLiquidity = {
  lovelace: 0n + 1000n, // There was 0 ADA previously
  [unit]: 42n - 10n,    // There was 42 PIZADA previously
}


try {
  lucid.selectWalletFromPrivateKey(privateKeyBob)
  tx = await lucid.newTx()
    .collectFrom([binUtxos[0]], Data.to(bobRedeemer, Redeemer))
    .attachSpendingValidator(liquidityBinScript)
    .payToContract(liquidityBinAddress, {inline: Data.to(bobDatum, Datum)}, newBinLiquidity)
    .collectFrom([bobUtxos[0]])
    .complete({coinSelection: false})
  console.log("Bob swaps 1000 ADA for 10 PIZADA:")
  console.log(await txRecord(tx, lucid, knownAddresses))
  await sendTx(tx);
  emulator.awaitBlock(4)
} catch (error) {
  console.log("Failed with error:")
  console.log(error)
  throw new Error("You can do it!")
}