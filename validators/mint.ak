use aiken/hash.{Blake2b_224, Hash}
use aiken/list
use aiken/transaction.{ScriptContext}
use aiken/transaction/credential.{VerificationKey}

type Datum {
  owner: Hash<Blake2b_224, VerificationKey>,
}

validator {
  fn always_mint(_redeemer: Void, _context: ScriptContext) -> Bool {
    True
  }
}
