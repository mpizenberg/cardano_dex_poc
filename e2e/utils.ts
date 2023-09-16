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
    const allBalances = new Map()
    // Remove consumed inputs from balances
    for (const input of inputs) {
        const address = input.address
        for (const [key, value] of Object.entries(input.assets)) {
            allBalances.set(`${address},${key}`, (allBalances.get(`${address},${key}`) || 0n) - value)
        }
    }
    // Add outputs to balances
    for (const output of outputs) {
        const address = output.address
        const lovelace = BigInt(output.amount.coin)
        allBalances.set(`${address},lovelace`, (allBalances.get(`${address},lovelace`) || 0n) + lovelace)
        // TODO: handle other assets than Ada
    }
    // Aggregate balances per address
    const balances = new Map()
    for (const [key, value] of allBalances.entries()) {
        const [address, asset] = key.split(",")
        appendInHashMap(balances, address, {asset, value})
    }
    return balances
}

// Append an element to an array inside the hashmap, even if the key does not exist.
function appendInHashMap(hashMap, key, element) {
    if (key in hashMap) {
        hashMap.get(key).push(element)
    } else {
        hashMap.set(key, [element])
    }
}