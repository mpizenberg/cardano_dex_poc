// $ deno run -A emulate_vault.ts
import {
  Address,
  Data,
  Emulator,
  Lucid,
  SpendingValidator,
  TxHash,
  Constr,
  C,
  getAddressDetails,
  generateSeedPhrase,
} from "https://deno.land/x/lucid@0.10.7/mod.ts";

import { txRecord } from "./utils.ts";

// Define wallets, balances and Custom network

const aliceSeedPhrase = generateSeedPhrase();
const aliceAddress = await (await Lucid.new(undefined, "Custom"))
  .selectWalletFromSeed(aliceSeedPhrase).wallet.address();
const aliceAddressDetails = getAddressDetails(aliceAddress)
console.log("aliceAddressDetails:", aliceAddressDetails)

const emulator = new Emulator([{
  address: aliceAddress,
  assets: { lovelace: 2000_000000n },
}]);
const lucid = await Lucid.new(emulator);

// Load the smart contracts

const validator = JSON.parse(await Deno.readTextFile("plutus.json")).validators.find(
  (v) => v.title === "vault.vault"
);

const validatorScript: SpendingValidator = {
  type: "PlutusV2",
  script: validator.compiledCode,
};

const validatorAddress: Address = lucid.utils.validatorToAddress(
  validatorScript,
);
const validatorAddressDetails = getAddressDetails(validatorAddress)
console.log("validator address details:", validatorAddressDetails)

// Define nicknames for known addresses
const knownAddresses = new Map()
knownAddresses.set(aliceAddress, "Alice")
knownAddresses.set(validatorAddress, "vault")

// Helper function to submit a transaction
async function sendTx(tx): Promise<TxHash> {
  const signedTx = await tx.sign().complete();
  return await signedTx.submit();
}

// MAIN

// Build new address with the script payment credentials but Alice staking credentials
const mixedAddress = C.BaseAddress.new(
  validatorAddressDetails.networkId,
  C.StakeCredential.from_scripthash(C.ScriptHash.from_hex(validatorAddressDetails.paymentCredential!.hash)),
  C.StakeCredential.from_keyhash(C.Ed25519KeyHash.from_hex(aliceAddressDetails.stakeCredential!.hash)),
).to_address().to_bech32("addr_test")
knownAddresses.set(mixedAddress, "vault with Alice stake")
const mixedAddressDetails = getAddressDetails(mixedAddress)
console.log("mixedAddressDetails:", mixedAddressDetails)

// Alice locks 100 Ada in the vault with it's own staking credentials.
lucid.selectWalletFromSeed(aliceSeedPhrase)
const aliceHash = aliceAddressDetails.paymentCredential!.hash;
const aliceDatum = Data.to(new Constr(0, [aliceHash]));
let tx = await lucid.newTx()
  .payToContract(mixedAddress, { inline: aliceDatum }, { lovelace: 100_000000n })
  .complete();
console.log("Transaction where Alice sends 100 ada to the vault while keeping her stake:")
console.log(await txRecord(tx, lucid, knownAddresses))
await sendTx(tx);

// Make progress in the emulator
emulator.awaitBlock(4)

// Retrieve the UTxO in Alice's vault
const vaultUtxo = (await lucid.utxosAt(mixedAddressDetails.paymentCredential!))[0]

// Alice partially retrieves her Ada from the vault
lucid.selectWalletFromSeed(aliceSeedPhrase)
tx = await lucid.newTx()
  .collectFrom([vaultUtxo], Data.void()) // collect the 100 Ada in the UTxO ...
  .attachSpendingValidator(validatorScript)
  .addSigner(aliceAddress)
  .payToContract(mixedAddress, { inline: aliceDatum }, { lovelace: 50_000000n }) // .. and put 50 back into it
  .complete()
console.log("Transaction where Alice retrieves 50 ada of the 100 ada in the vault:")
console.log(await txRecord(tx, lucid, knownAddresses))
await sendTx(tx);

// Make progress in the emulator
emulator.awaitBlock(4)
