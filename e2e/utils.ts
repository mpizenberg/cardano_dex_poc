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

export function listTxInputs(cmlTxInputs: C.TransactionInputs | undefined) {
    const refInputs = []
    if (cmlTxInputs) {
        for (const {transaction_id, index} of cmlTxInputs.to_js_value()) {
            refInputs.push({txHash: transaction_id, outputIndex: index})
        }
    }
    return refInputs
}