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

// Load the smart contracts

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
const unit1 = policyId + fromText ("PIZADA1");
const unit2 = policyId + fromText ("PIZADA2");

// Define nicknames for known addresses
const knownAddresses = new Map()
knownAddresses.set(aliceAddress, "Alice")
knownAddresses.set(bobAddress, "Bob")
knownAddresses.set(alwaysMintAddress, "MintContract")

// Helper function to submit a transaction
async function sendTx(tx): Promise<TxHash> {
  const signedTx = await tx.sign().complete();
  return await signedTx.submit();
}

// MAIN
console.log("Alice before sending to script");
console.log(await lucid.utxosAt(aliceAddress));

console.log("Bob before sending to script");
console.log(await lucid.utxosAt(bobAddress));

// Alice mints 10 PIZADA1 and 20 PIZADA2.
lucid.selectWalletFromPrivateKey(privateKeyAlice)
// const aliceHash = lucid.utils.getAddressDetails(aliceAddress)
//   .paymentCredential?.hash;
// const aliceDatum = Data.to(new Constr(0, [aliceHash]));
let tx = await lucid.newTx()
  .mintAssets({[unit1]: 10n, [unit2]: 20n}, Data.void())
  .attachMintingPolicy(alwaysMintScript)
  .complete();
console.log("Transaction where Alice mints 10 PIZADA1 and 20 PIZADA2:")
console.log(await txRecord(tx, lucid, knownAddresses))
await sendTx(tx);

// Make progress in the emulator
emulator.awaitBlock(4)

// Alice burns 10 PIZADA1
tx = await lucid.newTx()
  .mintAssets({[unit1]: -10n}, Data.void())
  .attachMintingPolicy(alwaysMintScript)
  .complete();
console.log("Transaction where Alice burns 10 PIZADA1:")
console.log(await txRecord(tx, lucid, knownAddresses))
await sendTx(tx);

// Make progress in the emulator
emulator.awaitBlock(4)


// #############################################################################
// Now emulate mint_once validator

// Pick the required UTxO for the mint_once validator
// Let's say we pick the one at index 1 of the list (it has more Ada)

const aliceUtxos = await lucid.utxosAt(aliceAddress)
const requiredUtxo = aliceUtxos[1]
const requiredUtxoRef = new Constr(0, [
  new Constr(0, [requiredUtxo.txHash]),
  BigInt(requiredUtxo.outputIndex),
]);

// Apply that as the required utxo in the validator parameters

const mintOnceValidator = JSON.parse(await Deno.readTextFile("plutus.json")).validators.find(
  (v) => v.title === "mint.mint_once"
);

const appliedMintOnceValidator: string = applyParamsToScript(mintOnceValidator.compiledCode, [requiredUtxoRef])

const appliedMintOncePolicy: MintingPolicy = {
  type: "PlutusV2",
  script: applyDoubleCborEncoding(appliedMintOnceValidator),
}

const appliedMintOncePolicyId: PolicyId = lucid.utils.mintingPolicyToId(appliedMintOncePolicy)

const appliedMintOnceAddress: Address = lucid.utils.validatorToAddress(appliedMintOncePolicy)

knownAddresses.set(appliedMintOnceAddress, "MintOnceContract")

// Mint 42 PIZADA3 once and forever!
const unit3 = appliedMintOncePolicyId + fromText("PIZADA3")
tx = await lucid.newTx()
  .mintAssets({[unit3]: 42n}, Data.void())
  .attachMintingPolicy(appliedMintOncePolicy)
  .complete();
console.log("Transaction where Alice mints 42 PIZADA3:")
console.log(await txRecord(tx, lucid, knownAddresses))
await sendTx(tx);

// Make progress in the emulator
emulator.awaitBlock(4)