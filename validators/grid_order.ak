use aiken/cbor
use aiken/hash.{Blake2b_224, Hash}
use aiken/list
use aiken/transaction.{
  InlineDatum, Input, Output, OutputReference, ScriptContext, Spend,
}
use aiken/transaction/credential.{VerificationKey}
use aiken/transaction/value.{AssetName, PolicyId}

type GridDatum {
  owner: Hash<Blake2b_224, VerificationKey>,
  grid_id: Int,
  asset_1: (PolicyId, AssetName),
  asset_2: (PolicyId, AssetName),
  ratio_buy_1: (Int, Int),
  ratio_sell_1: (Int, Int),
  // alternate between True and False
  hold_1: Bool,
  from_utxo: Option<OutputReference>,
}

type Redeemer {
  index_input: Int,
  index_output: Int,
}

validator {
  fn grid_order(
    datum: GridDatum,
    redeemer: Redeemer,
    context: ScriptContext,
  ) -> Bool {
    let is_signed = list.has(context.transaction.extra_signatories, datum.owner)
    is_signed || valid_grid_order(datum, redeemer, context)
  }
}

fn valid_grid_order(
  datum: GridDatum,
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
  expect (old_utxo_ref == purpose_utxo_ref)?
  // Check the new UTxO is sent to the same address (grid order smart contract)
  expect (old_utxo.address == new_utxo.address)?
  // Extract the new datum for the output UTxO
  trace @"toto3"
  expect InlineDatum(new_inline_datum) = new_utxo.datum
  trace @"new_inline_datum:"
  trace cbor.diagnostic(new_inline_datum)
  trace @"purpose datum:"
  trace cbor.diagnostic(datum)
  expect new_utxo_datum: GridDatum = new_inline_datum
  // Check the new UTxO references the old UTxO in its datum (to avoid double satisfaction)
  expect (new_utxo_datum.from_utxo == Some(old_utxo_ref))?
  // Check the new UTxO has the same owner, assets and grid price levels
  expect (new_utxo_datum.owner == datum.owner)?
  expect (new_utxo_datum.asset_1 == datum.asset_1)?
  expect (new_utxo_datum.asset_2 == datum.asset_2)?
  expect (new_utxo_datum.ratio_buy_1 == datum.ratio_buy_1)?
  expect (new_utxo_datum.ratio_sell_1 == datum.ratio_sell_1)?
  // Check that the "hold_1" field is toggled
  expect (new_utxo_datum.hold_1 != datum.hold_1)?
  // Check the swapped assets follow the grid price levels
  valid_grid_swap_amount(old_utxo, new_utxo, datum)
}

fn valid_grid_swap_amount(
  old_utxo: Output,
  new_utxo: Output,
  datum: GridDatum,
) -> Bool {
  // Extract the assets and prices of the two grid orders
  let (policy_1, name_1) = datum.asset_1
  let (policy_2, name_2) = datum.asset_2
  let (buy_1_limit, sell_2_limit) = datum.ratio_buy_1
  let (sell_1_limit, buy_2_limit) = datum.ratio_sell_1
  expect (buy_1_limit >= 0)? && (sell_2_limit >= 0)?
  expect (sell_1_limit >= 0)? && (buy_2_limit >= 0)?
  // Check the stupidity budget of the thing building the datum
  // Otherwise, they will lose all their deposit
  expect (buy_1_limit * buy_2_limit >= sell_1_limit * sell_2_limit)?
  // Retrieve the balance of both tokens
  let old_value_1 = value.quantity_of(old_utxo.value, policy_1, name_1)
  let new_value_1 = value.quantity_of(new_utxo.value, policy_1, name_1)
  let old_value_2 = value.quantity_of(old_utxo.value, policy_2, name_2)
  let new_value_2 = value.quantity_of(new_utxo.value, policy_2, name_2)
  let delta_1 = new_value_1 - old_value_1
  let delta_2 = new_value_2 - old_value_2
  trace @"delta_1"
  trace cbor.diagnostic(delta_1)
  trace @"delta_2"
  trace cbor.diagnostic(delta_2)
  // Check that value changes are coherent with the limit price
  if datum.hold_1 {
    // Holding asset 1 that we want to sell to buy asset 2
    expect (delta_1 <= 0)? && (delta_2 >= 0)?
    // Check the price is fair
    expect (delta_2 * sell_1_limit >= -delta_1 * buy_2_limit)?
    // Check the whole amount is swapped if not ada, or at most 2 ada is left
    if datum.asset_1 == ("", "") {
      new_value_1 <= 2000000
    } else {
      new_value_1 == 0
    }
  } else {
    // Holding asset 2 that we want to sell to buy asset 1
    expect (delta_1 >= 0)? && (delta_2 <= 0)?
    // Check the price is fair
    expect (delta_1 * sell_2_limit >= -delta_2 * buy_1_limit)?
    // Check the whole amount is swapped if not ada, or at most 2 ada is left
    if datum.asset_2 == ("", "") {
      new_value_2 <= 2000000
    } else {
      new_value_2 == 0
    }
  }
}
