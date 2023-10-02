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
  (v) => v.title === "mint.always_mint"
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
// Alice deposits 42 PIZADA in liquidity at the price 1 PIZADA = 100 ADA

const aliceHash = lucid.utils.getAddressDetails(aliceAddress)
  .paymentCredential?.hash;

const swapItemSchema = Data.Tuple([Data.Bytes(), Data.Bytes(), Data.Integer()])
const outputRefSchema = Data.Object({
  transaction_id: Data.Bytes(),
  output_index: Data.Integer(),
})
const DatumSchema = Data.Object({
  owner: Data.Bytes(),
  swap_rate: Data.Tuple([swapItemSchema, swapItemSchema]),
  from_utxo: Data.Nullable(outputRefSchema),
})

type Datum = Data.Static<typeof DatumSchema>
const Datum = DatumSchema as unknown as Datum
const datum: Datum = {
  owner: aliceHash!,
  swap_rate: [["", "", 100n], [policyId, fromText("PIZADA"), 1n]], // 1 PIZADA = 100 ADA
  // from_utxo: {transaction_id: "", output_index: 0n},
  from_utxo: null,
}

lucid.selectWalletFromPrivateKey(privateKeyAlice)
tx = await lucid.newTx()
  .payToContract(liquidityBinAddress, {inline: Data.to(datum, Datum)}, {[unit]: 42n})
  .complete({coinSelection: true})
console.log("Send 42 PIZADA to the liquidity contract:")
console.log(await txRecord(tx, lucid, knownAddresses))
await sendTx(tx);
emulator.awaitBlock(4)