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
fromUnit,
} from "https://deno.land/x/lucid@0.10.7/mod.ts";


export async function txRecord(txComplete : TxComplete, provider: any, knownAddresses: any) {
    const tx = txComplete.txComplete   // https://deno.land/x/lucid@0.10.1/mod.ts?s=C.Transaction
    const txBody = tx.body()           // https://deno.land/x/lucid@0.10.1/mod.ts?s=C.TransactionBody
    const txInputs = txBody.inputs()   // https://deno.land/x/lucid@0.10.1/mod.ts?s=C.TransactionInputs
    const txOutputs = txBody.outputs() // https://deno.land/x/lucid@0.10.1/mod.ts?s=C.TransactionOutputs
    const txFee = BigInt(txBody.fee().to_str())
    const txRedeemers = tx.witness_set().redeemers()

    // Retrieve the input and output UTxOs
    const inputsRefs = listTxInputs(txInputs)
    const inputUtxos = await provider.utxosByOutRef(inputsRefs)
    const outputUtxos = txOutputs.to_js_value()

    // Compute the UTxOs balance and replace known addresses by their names
    const txBalance = utxoBalance(inputUtxos, outputUtxos)
    const namedBalance = new Map()
    for (const [address, values] of txBalance) {
        if (knownAddresses.has(address)) {
            namedBalance.set(knownAddresses.get(address), values)
        } else {
            namedBalance.set(address, values)
        }
    }

    // Add a "knownAddress" field to UTxOs
    for (const utxo of inputUtxos) {
        utxo.knownAddress = knownAddresses.get(utxo.address)
    }
    for (const utxo of outputUtxos) {
        utxo.knownAddress = knownAddresses.get(utxo.address)
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
        // 0: inputTag "Spend"
        // 1: mintTag  "Mint"
        // 2: certTag  "Cert"
        // 3: wdrlTag  "Reward"
        const memory = redeemer.ex_units().mem().to_str()
        const cpu = redeemer.ex_units().steps().to_str()
        redeemers.push({index: redeemerIndex, tag, memory, cpu})
      }
    }

    return {
        fees: txFee,
        balance: namedBalance,
        details: {
            inputs: inputUtxos,
            outputs: outputUtxos,
            referenceInputs: refInputs,
            redeemers: redeemers,
        },
    }

    // TODO:
    // - associate known ref inputs contracts with nicknames
    // - pretty print
}

// Convert a C.TransactionInputs object into a list of {txHash, outputIndex}
export function listTxInputs(cmlTxInputs: C.TransactionInputs | undefined) {
    const refInputs = []
    if (cmlTxInputs) {
        for (const {transaction_id, index} of cmlTxInputs.to_js_value()) {
            refInputs.push({txHash: transaction_id, outputIndex: index})
        }
    }
    return refInputs
}

// Compute the balances of input and output UTxOs per address
export function utxoBalance(inputs: UTxO[], outputs: any) {
    const allBalances = new Map()
    // Remove consumed inputs from balances
    for (const input of inputs) {
        const address = input.address
        for (const [key, value] of Object.entries(input.assets)) {
            if (key == "lovelace") {
                allBalances.set(`${address},lovelace`, (allBalances.get(`${address},lovelace`) || 0n) - value)
            } else {
                const {policyId, name} = fromUnit(key)
                const nameUtf8 = new TextDecoder().decode(fromHex(name))
                allBalances.set(`${address},${nameUtf8}`, (allBalances.get(`${address},${nameUtf8}`) || 0n) - value)
            }
        }
    }
    // Add outputs to balances
    for (const output of outputs) {
        const address = output.address
        const lovelace = BigInt(output.amount.coin)
        allBalances.set(`${address},lovelace`, (allBalances.get(`${address},lovelace`) || 0n) + lovelace)
        // Handle other assets than Ada
        for (const [_policyId, coins] of Object.entries(output.amount.multiasset || [])) {
            for (const [name, amountStr] of Object.entries(coins)) {
                const nameUtf8 = new TextDecoder().decode(fromHex(name))
                const amount = BigInt(amountStr)
                allBalances.set(`${address},${nameUtf8}`, (allBalances.get(`${address},${nameUtf8}`) || 0n) + amount)
            }
        }
    }
    // Aggregate balances per address
    const balances = new Map()
    for (const [key, value] of allBalances) {
        const [address, asset] = key.split(",")
        if (value != 0) {
            appendInHashMap(balances, address, {asset, value})
        }
    }
    return balances
}

// Append an element to an array inside the hashmap, even if the key does not exist.
function appendInHashMap(hashMap, key, element) {
    if (hashMap.has(key)) {
        hashMap.get(key).push(element)
    } else {
        hashMap.set(key, [element])
    }
}