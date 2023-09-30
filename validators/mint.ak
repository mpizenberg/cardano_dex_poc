use aiken/hash.{Blake2b_224, Hash}
use aiken/list
use aiken/transaction.{OutputReference, ScriptContext}
use aiken/transaction/credential.{VerificationKey}

validator {
  fn always_mint(_redeemer: Void, _context: ScriptContext) -> Bool {
    True
  }
}

// Check that the required UTxO is present in the inputs of the transaction.
// This basically enforce a unique mint event by ledger rules,
// as a UTxO can only be consumed once.
validator(required_utxo: OutputReference) {
  fn mint_once(_redeemer: Void, context: ScriptContext) -> Bool {
    list.any(
      context.transaction.inputs,
      fn(input) { input.output_reference == required_utxo },
    )
  }
}
