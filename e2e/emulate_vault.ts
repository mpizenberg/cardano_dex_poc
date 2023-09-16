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

import { listTxInputs, utxoBalance } from "./utils.ts";

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
await sendTx(tx);

// Make progress in the emulator
emulator.awaitBlock(4)

console.log("Alice after script send to reference UTxO");
console.log(await lucid.utxosAt(addressAlice));

console.log("Fail address after script send to reference UTxO");
console.log(await lucid.utxosAt(failAddress));

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
await sendTx(tx);

// Make progress in the emulator
emulator.awaitBlock(4)

console.log("Alice after locking 100 Ada into the vault");
console.log(await lucid.utxosAt(addressAlice));

console.log("Vault address after locking 100 Ada into the vault");
console.log(await lucid.utxosAt(validatorAddress));

const knownAddresses = new Map()
knownAddresses.set(addressAlice, "Alice")
knownAddresses.set(addressBob, "Bob")
knownAddresses.set(validatorAddress, "vault")

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
  console.log("Bob's transaction with Alice's vault is invalid, and fails with the error:")
  console.log(error)
}

// Alice partially retrieves her Ada from the vault
lucid.selectWalletFromPrivateKey(privateKeyAlice)
tx = await lucid.newTx()
  .readFrom([referenceScriptUtxo])
  .collectFrom([vaultUtxo], Data.void()) // collect the 100 Ada in the UTxO ...
  .addSigner(addressAlice)
  .payToContract(validatorAddress, { inline: aliceDatum }, { lovelace: 50_000000n }); // .. and put 50 back into it
console.log("The transaction collecting 100 Ada and putting 50 Ada back")
console.log(tx)
//  .complete();
tx = await tx.complete()
console.log(tx.toString())
console.log(knownAddresses)
console.log(await prettyPrintTx(tx))
await sendTx(tx);

// Make progress in the emulator
emulator.awaitBlock(4)

console.log("Alice after collecting the 100 Ada from the vault and putting 50 back into it");
console.log(await lucid.utxosAt(addressAlice));

console.log("Vault address after collecting the 100 Ada from the vault and putting 50 back into it");
console.log(await lucid.utxosAt(validatorAddress));

async function prettyPrintTx(txComplete : TxComplete) {
  // const txBytes = fromHex(txComplete.toString())
  // const tx = C.Transaction.from_bytes(txBytes)
  // return tx.to_json()
  const tx = txComplete.txComplete   // https://deno.land/x/lucid@0.10.1/mod.ts?s=C.Transaction
  const txBody = tx.body()           // https://deno.land/x/lucid@0.10.1/mod.ts?s=C.TransactionBody
  const txInputs = txBody.inputs()   // https://deno.land/x/lucid@0.10.1/mod.ts?s=C.TransactionInputs
  const txOutputs = txBody.outputs() // https://deno.land/x/lucid@0.10.1/mod.ts?s=C.TransactionOutputs
  const txFee = txBody.fee()
  const txRedeemers = tx.witness_set().redeemers()

  // Retrieve the input UTxOs
  const inputsRefs = listTxInputs(txInputs)
  const inputUtxos = await lucid.utxosByOutRef(inputsRefs)

  // Check if the UTxOs addresses are known.
  for (const utxo of inputUtxos) {
    const fullAddress = utxo.address
    utxo.knownAddress = knownAddresses.get(fullAddress)
  }

  // Retrieve reference inputs
  const refInputs = listTxInputs(txBody.reference_inputs())

  // Retrieve the redeemers
  const redeemers = []
  if (txRedeemers) {
    for (let index = 0; index < txRedeemers.len(); index++) {
      const redeemer = txRedeemers.get(index)
      const redeemerIndex = redeemer.index().to_str()
      const tag = redeemer.tag().kind()
      const memory = redeemer.ex_units().mem().to_str()
      const cpu = redeemer.ex_units().steps().to_str()
      redeemers.push({index: redeemerIndex, tag, memory, cpu})
    }
  }

  // Log stuff
  console.log(inputUtxos)
  console.log(refInputs)
  console.log(txBody)
  console.log(txOutputs.to_js_value())
  console.log("fee:", txFee.to_str())
  console.log(redeemers)
  console.log(utxoBalance(inputUtxos, txOutputs.to_js_value()))

  // TODO:
  // - associate known addresses with nicknames
  // - associate known ref inputs contracts with nicknames
  // - pretty print lovelaces by splitting at Ada level with underscore _
  // - pretty print string numbers by splitting 3 digits with _
  // - or pretty print with 3 significative digits human readable like 18.2K or 1.32M
}