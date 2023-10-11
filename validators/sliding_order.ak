use aiken/cbor
use aiken/hash.{Blake2b_224, Hash}
use aiken/interval.{Finite, Interval}
use aiken/list
use aiken/math.{abs}
use aiken/time.{PosixTime}
use aiken/transaction.{
  InlineDatum, Input, Output, OutputReference, ScriptContext, Spend,
}
use aiken/transaction/credential.{VerificationKey, VerificationKeyCredential}
use aiken/transaction/value.{AssetName, PolicyId}

type SlidingDatum {
  owner: Hash<Blake2b_224, VerificationKey>,
  sell_asset: (PolicyId, AssetName),
  buy_asset: (PolicyId, AssetName),
  sell_amount: Int,
  buy_amount_start: Int,
  buy_amount_slope_per_ms: (Int, Int),
  start_time: PosixTime,
}

type Redeemer {
  index_input: Int,
  index_output: Int,
}

validator {
  fn sliding_order(
    datum: SlidingDatum,
    redeemer: Redeemer,
    context: ScriptContext,
  ) -> Bool {
    let is_signed = list.has(context.transaction.extra_signatories, datum.owner)
    is_signed || valid_sliding_order(datum, redeemer, context)
  }
}

fn valid_sliding_order(
  datum: SlidingDatum,
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
  // Check the new UTxO is sent to the owner of the order
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
  // Check the swapped assets follow the sliding price
  let time_range = context.transaction.validity_range
  valid_swap_amount(old_utxo, new_utxo, datum, time_range)
}

fn valid_swap_amount(
  old_utxo: Output,
  new_utxo: Output,
  datum: SlidingDatum,
  time_range: Interval<PosixTime>,
) -> Bool {
  // Extract the assets of the limit order
  let (sell_policy, sell_name) = datum.sell_asset
  let (buy_policy, buy_name) = datum.buy_asset
  expect (datum.sell_amount >= 0)?
  expect (datum.buy_amount_start >= 0)?
  // Retrieve the balance of the buy and sell tokens
  let old_sell_value = value.quantity_of(old_utxo.value, sell_policy, sell_name)
  let new_sell_value = value.quantity_of(new_utxo.value, sell_policy, sell_name)
  let sell_amount = old_sell_value - new_sell_value
  let old_buy_value = value.quantity_of(old_utxo.value, buy_policy, buy_name)
  let new_buy_value = value.quantity_of(new_utxo.value, buy_policy, buy_name)
  let buy_amount = new_buy_value - old_buy_value
  trace @"sell_amount"
  trace cbor.diagnostic(sell_amount)
  trace @"buy_amount"
  trace cbor.diagnostic(buy_amount)
  // Compute the slided price with the start of the time range.
  // Cheating would only be possible if price is more advantageous with earlier start time.
  // However, using an earlier start time also means that the time range increases,
  // otherwise the time range would not be valid at execution time.
  // One simple anti-cheating rule is therefore to degrade the price with the range width.
  trace @"Check that the time range bounds are finite"
  trace @"lower_bound:"
  trace cbor.diagnostic(time_range.lower_bound.bound_type)
  trace @"upper_bound:"
  trace cbor.diagnostic(time_range.upper_bound.bound_type)
  expect Finite(range_start) = time_range.lower_bound.bound_type
  expect Finite(range_end) = time_range.upper_bound.bound_type
  // Check that value changes are coherent with the sliding price
  expect (sell_amount <= datum.sell_amount)?
  let delta_time_ms = range_start - datum.start_time
  expect (delta_time_ms >= 0)?
  let (s1, s2) = datum.buy_amount_slope_per_ms
  expect (s2 > 0)?
  // buy_amount >= datum.buy_amount_start + (s1/s2) * delta_time_ms + abs(s1/s2) * (range_end - range_start)
  // And since s2 is positive:
  // s2 * buy_amount >= s2 * datum.buy_amount_start + s1 * delta_time_ms + abs(s1) * (range_end - range_start)
  let s2_dirac_buy = s2 * datum.buy_amount_start + s1 * delta_time_ms
  let s2_range_penality = abs(s1) * ( range_end - range_start )
  trace @"Check that the buy amount is correct"
  s2 * buy_amount >= s2_dirac_buy + s2_range_penality
}
