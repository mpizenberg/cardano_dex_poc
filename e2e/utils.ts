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

export function utxoBalance(inputs: UTxO[], outputs: any) {
    const balances = new Map()
    // Remove consumed inputs from balances
    for (const input of inputs) {
        const address = input.address
        for (const [key, value] of Object.entries(input.assets)) {
            balances.set(`${address},${key}`, (balances.get(`${address},${key}`) || 0n) - value)
        }
    }
    // Add outputs to balances
    for (const output of outputs) {
        const address = output.address
        const lovelace = BigInt(output.amount.coin)
        balances.set(`${address},lovelace`, (balances.get(`${address},lovelace`) || 0n) + lovelace)
        // TODO: handle other assets than Ada
    }
    // Return balances
    return balances
}