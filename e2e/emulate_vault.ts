// $ deno run -A emulate_vault.ts
import {
  Address,
  Data,
  Emulator,
  generatePrivateKey,
  Lovelace,
  Lucid,
  PrivateKey,
  SpendingValidator,
  TxHash,
  UTxO,
  Constr,
  Tx,
  C,
  TxComplete,
  fromHex,
} from "https://deno.land/x/lucid@0.10.7/mod.ts";
// import { Datum } from "https://deno.land/x/lucid@0.10.7/src/core/libs/cardano_multiplatform_lib/cardano_multiplatform_lib.generated.js";

import { listTxInputs, txRecord, utxoBalance } from "./utils.ts";

// Define wallets, balances and Custom network

const privateKeyAlice = generatePrivateKey();
const privateKeyBob = generatePrivateKey();

const addressAlice = await (await Lucid.new(undefined, "Custom"))
  .selectWalletFromPrivateKey(privateKeyAlice).wallet.address();

const addressBob = await (await Lucid.new(undefined, "Custom"))
  .selectWalletFromPrivateKey(privateKeyBob).wallet.address();

const emulator = new Emulator([{
  address: addressAlice,
  assets: { lovelace: 2000_000000n },
}, {
  address: addressBob,
  assets: { lovelace: 3000_000000n },
}]);

// Load the smart contracts

const alwaysFailValidator = JSON.parse(await Deno.readTextFile("plutus.json")).validators.find(
  (v) => v.title === "vault.always_fail"
);

const alwaysFailScript: SpendingValidator = {
  type: "PlutusV2",
  script: alwaysFailValidator.compiledCode,
};

const validator = JSON.parse(await Deno.readTextFile("plutus.json")).validators.find(
  (v) => v.title === "vault.vault"
);

const validatorScript: SpendingValidator = {
  type: "PlutusV2",
  script: validator.compiledCode,
};
console.log("Validator script:\n", validatorScript)

// Start Custom Network

const lucid = await Lucid.new(emulator);

// Generate Script Addresses from contracts

const failAddress: Address = lucid.utils.validatorToAddress(
  alwaysFailScript,
);
const validatorAddress: Address = lucid.utils.validatorToAddress(
  validatorScript,
);

// Define nicknames for known addresses
const knownAddresses = new Map()
knownAddresses.set(addressAlice, "Alice")
knownAddresses.set(addressBob, "Bob")
knownAddresses.set(validatorAddress, "vault")
knownAddresses.set(failAddress, "blackhole")

// Helper function to submit a transaction
async function sendTx(tx): Promise<TxHash> {
  const signedTx = await tx.sign().complete();
  return await signedTx.submit();
}

// MAIN
console.log("Alice before sending to script");
console.log(await lucid.utxosAt(addressAlice));

console.log("Bob before sending to script");
console.log(await lucid.utxosAt(addressBob));

console.log("Script Address before any transaction");
console.log(await lucid.utxosAt(validatorAddress));

// Store the contract into a non-spendable UTxO for later use as reference

lucid.selectWalletFromPrivateKey(privateKeyAlice)
let tx = await lucid.newTx()
  .payToContract(failAddress, {
    asHash: Data.void(),
    scriptRef: validatorScript,
  }, {})
  .complete();
console.log("Transaction storing the vault contract in the blackhole (always fail) address:")
console.log(await txRecord(tx, lucid, knownAddresses))
await sendTx(tx);

// Make progress in the emulator
emulator.awaitBlock(4)

// Retrieve the UTxO of the reference script
const referenceScriptUtxo = (await lucid.utxosAt(failAddress)).find(
  (utxo) => Boolean(utxo.scriptRef),
);
if (!referenceScriptUtxo) throw new Error("Reference script not found");

// Alice locks 100 Ada in the vault.
lucid.selectWalletFromPrivateKey(privateKeyAlice)
const aliceHash = lucid.utils.getAddressDetails(addressAlice)
  .paymentCredential?.hash;
const aliceDatum = Data.to(new Constr(0, [aliceHash]));
tx = await lucid.newTx()
  .payToContract(validatorAddress, { inline: aliceDatum }, { lovelace: 100_000000n })
  .complete();
console.log("Transaction where Alice sends 100 ada to the vault:")
console.log(await txRecord(tx, lucid, knownAddresses))
await sendTx(tx);

// Make progress in the emulator
emulator.awaitBlock(4)

// Retrieve the UTxO in Alice's vault
const vaultUtxo = (await lucid.utxosAt(validatorAddress))[0]

// Bob attempts to steal Alice's vault
lucid.selectWalletFromPrivateKey(privateKeyBob)
try {
  tx = await lucid.newTx()
    .readFrom([referenceScriptUtxo])
    .collectFrom([vaultUtxo], Data.void())
    .addSigner(addressBob)
    .complete();
  await sendTx(tx);
  emulator.awaitBlock(4)
} catch (error) {
  console.log("Bob's attempt to retrieve Alice's vault is invalid, and fails with this error:")
  console.log(error)
}

// Alice partially retrieves her Ada from the vault
lucid.selectWalletFromPrivateKey(privateKeyAlice)
tx = await lucid.newTx()
  .readFrom([referenceScriptUtxo])
  .collectFrom([vaultUtxo], Data.void()) // collect the 100 Ada in the UTxO ...
  .addSigner(addressAlice)
  .payToContract(validatorAddress, { inline: aliceDatum }, { lovelace: 50_000000n }) // .. and put 50 back into it
  .complete()
console.log("Transaction where Alice retrieves 50 ada of the 100 ada in the vault:")
console.log(await txRecord(tx, lucid, knownAddresses))
await sendTx(tx);

// Make progress in the emulator
emulator.awaitBlock(4)
