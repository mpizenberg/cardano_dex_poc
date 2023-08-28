// $ deno run -A always_succeeds.ts
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
  } from "https://deno.land/x/lucid@0.10.7/mod.ts";
  
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
  
  // Define: Smart Contract (always succeeds)
  
  const alwaysSucceedScript: SpendingValidator = {
    type: "PlutusV2",
    script: "49480100002221200101",
  };
  
  const Datum = () => Data.void();
  const Redeemer = () => Data.void();
  
  // Start Custom Network
  
  const lucid = await Lucid.new(emulator);
  
  // Generate Script Address from Contract
  const alwaysSucceedAddress: Address = lucid.utils.validatorToAddress(
    alwaysSucceedScript,
  );
  
  function getBalance(privateKey: PrivateKey): Promise<UTxO[]> {
    // Set wallet to given owner for this transaction
    const owner: Lucid = lucid.selectWalletFromPrivateKey(privateKey);
    return owner.wallet.getUtxos();
  }
  
  async function lockUtxo(
    privateKey: PrivateKey,
    lovelace: Lovelace,
  ): Promise<TxHash> {
    // Set wallet to given owner for this transaction
    lucid.selectWalletFromPrivateKey(privateKey);
  
    const tx = await lucid
      .newTx()
      .payToContract(alwaysSucceedAddress, { inline: Datum() }, { lovelace })
      .payToContract(alwaysSucceedAddress, {
        asHash: Datum(),
        scriptRef: alwaysSucceedScript, // adding plutusV2 script to output
      }, {})
      .complete();
  
    const signedTx = await tx.sign().complete();
    const txHash = await signedTx.submit();
  
    return txHash;
  }
  
  try {
    console.log("Alice before sending to script");
    console.log(await getBalance(privateKeyAlice));
  
    console.log("Bob before sending to script");
    console.log(await getBalance(privateKeyBob));
  
    console.log("Script Address before transaction");
    console.log(await lucid.utxosAt(alwaysSucceedAddress));
  
    await lockUtxo(privateKeyAlice, 100_000000n);
    emulator.awaitBlock(4);
  
    console.log("Script Address after transaction");
    console.log(await lucid.utxosAt(alwaysSucceedAddress));
  
    await redeemUtxo(privateKeyBob);
    emulator.awaitBlock(4);
  
    console.log("Bob after spending from script");
    console.log(await getBalance(privateKeyBob));
  } catch (_e) {
    console.error(
      "Error: something went wrong.",
    );
  }
  
  async function redeemUtxo(privateKey: PrivateKey): Promise<TxHash> {
    const owner: Lucid = lucid.selectWalletFromPrivateKey(privateKey);
  
    const referenceScriptUtxo = (await owner.utxosAt(alwaysSucceedAddress)).find(
      (utxo) => Boolean(utxo.scriptRef),
    );
    if (!referenceScriptUtxo) throw new Error("Reference script not found");
  
    const utxo = (await owner.utxosAt(alwaysSucceedAddress)).find((utxo) =>
      utxo.datum === Datum() && !utxo.scriptRef
    );
    if (!utxo) throw new Error("Spending script utxo not found");
  
    const tx = await owner
      .newTx()
      .readFrom([referenceScriptUtxo]) // spending utxo by reading plutusV2 from reference utxo
      .collectFrom([utxo], Redeemer())
      .complete();
  
    const signedTx = await tx.sign().complete();
  
    const txHash = await signedTx.submit();
  
    return txHash;
  }
  