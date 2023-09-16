use aiken/hash.{Blake2b_224, Hash}
use aiken/list
use aiken/transaction.{ScriptContext}
use aiken/transaction/credential.{VerificationKey}

type Datum {
  owner: Hash<Blake2b_224, VerificationKey>,
}

validator {
  fn vault(datum: Datum, _redeemer: Void, context: ScriptContext) -> Bool {
    // The transaction must be signed by the owner
    list.has(context.transaction.extra_signatories, datum.owner)
  }
}

// A non-spendable validator, just to store the reference script
validator {
  fn always_fail(_datum: Void, _redeemer: Void, _context: ScriptContext) -> Bool {
    False
  }
}
