use aiken/cbor
use aiken/hash.{Blake2b_224, Hash}
use aiken/list
use aiken/transaction.{
  InlineDatum, Input, Output, OutputReference, ScriptContext, Spend,
}
use aiken/transaction/credential.{VerificationKey, VerificationKeyCredential}
use aiken/transaction/value.{AssetName, PolicyId}

type LimitDatum {
  owner: Hash<Blake2b_224, VerificationKey>,
  sell: (PolicyId, AssetName, Int),
  buy: (PolicyId, AssetName, Int),
}

type Redeemer {
  index_input: Int,
  index_output: Int,
}

validator {
  fn full_limit_order(
    datum: LimitDatum,
    redeemer: Redeemer,
    context: ScriptContext,
  ) -> Bool {
    or {
      // The transaction must be signed by the owner
      list.has(context.transaction.extra_signatories, datum.owner),
      // OR it follows the full limit order rules
      valid_full_limit_order(datum, redeemer, context),
    }
  }
}

fn valid_full_limit_order(
  datum: LimitDatum,
  redeemer: Redeemer,
  context: ScriptContext,
) -> Bool {
  // Retrieve the input UTxO at the given index
  expect Some(Input { output_reference: old_utxo_ref, output: old_utxo }) =
    list.at(context.transaction.inputs, redeemer.index_input)

  // Retrieve the output UTxO at the given index
  expect Some(new_utxo) =
    list.at(context.transaction.outputs, redeemer.index_output)

  // Check the old UTxO is the one from the spend purpose of the context
  expect Spend(purpose_utxo_ref) = context.purpose
  trace @"toto1"
  expect (old_utxo_ref == purpose_utxo_ref)?
  // Check the new UTxO is sent to the owner of the limit order
  trace @"toto2"
  expect VerificationKeyCredential(new_credential) =
    new_utxo.address.payment_credential
  expect (new_credential == datum.owner)?
  // Check the new UTxO reference the old UTxO in its datum (to avoid double satisfaction)
  trace @"toto3"
  expect InlineDatum(new_inline_datum) = new_utxo.datum
  trace @"toto4"
  trace @"new_inline_datum:"
  trace cbor.diagnostic(new_inline_datum)
  expect new_datum_ref: OutputReference = new_inline_datum
  expect (new_datum_ref == old_utxo_ref)?
  // Check the swapped assets follow the limit price
  valid_swap_amount(old_utxo, new_utxo, datum)
}

fn valid_swap_amount(
  old_utxo: Output,
  new_utxo: Output,
  datum: LimitDatum,
) -> Bool {
  // Extract the assets of the limit order
  let (sell_policy, sell_name, limit_sell_amount) = datum.sell
  let (buy_policy, buy_name, limit_buy_amount) = datum.buy
  expect (limit_sell_amount >= 0)?
  expect (limit_buy_amount >= 0)?
  // Retrieve the balance of the buy and sell tokens
  let old_sell_value = value.quantity_of(old_utxo.value, sell_policy, sell_name)
  let new_sell_value = value.quantity_of(new_utxo.value, sell_policy, sell_name)
  let sell_amount = old_sell_value - new_sell_value
  let old_buy_value = value.quantity_of(old_utxo.value, buy_policy, buy_name)
  let new_buy_value = value.quantity_of(new_utxo.value, buy_policy, buy_name)
  let buy_amount = new_buy_value - old_buy_value
  // Check that value changes are coherent with the limit price
  trace @"sell_amount"
  trace cbor.diagnostic(sell_amount)
  trace @"buy_amount"
  trace cbor.diagnostic(buy_amount)
  and {
    (sell_amount <= limit_sell_amount)?,
    (buy_amount >= limit_buy_amount)?,
  }
}
