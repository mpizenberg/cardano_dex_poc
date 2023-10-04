use aiken/cbor
use aiken/hash.{Blake2b_224, Hash}
use aiken/list
use aiken/transaction.{
  InlineDatum, Input, Output, OutputReference, ScriptContext, Spend,
}
use aiken/transaction/credential.{VerificationKey}
use aiken/transaction/value.{AssetName, PolicyId}

type Datum {
  owner: Hash<Blake2b_224, VerificationKey>,
  // TODO: move policies into validator parameterization
  swap_rate: ((PolicyId, AssetName, Int), (PolicyId, AssetName, Int)),
  from_utxo: Option<OutputReference>,
}

type Redeemer {
  index_input: Int,
  index_output: Int,
}

validator {
  fn liquidity_bin(
    datum: Datum,
    redeemer: Redeemer,
    context: ScriptContext,
  ) -> Bool {
    or {
      // The transaction must be signed by the owner
      list.has(context.transaction.extra_signatories, datum.owner),
      // OR it follows the swap rules
      valid_liquidity_swap(datum, redeemer, context),
    }
  }
}

fn valid_liquidity_swap(
  datum: Datum,
  redeemer: Redeemer,
  context: ScriptContext,
) -> Bool {
  // Retrieve the input UTxO at the given index
  expect Some(Input { output_reference: old_utxo_ref, output: old_utxo }) =
    list.at(context.transaction.inputs, redeemer.index_input)

  let inputs_refs =
    list.map(context.transaction.inputs, fn(input) { input.output_reference })
  trace @"Input adresses:"
  trace cbor.diagnostic(inputs_refs)

  // Retrieve the output UTxO at the given index
  expect Some(new_utxo) =
    list.at(context.transaction.outputs, redeemer.index_output)

  // Check the old UTxO is the one from the spend purpose of the context
  expect Spend(purpose_utxo_ref) = context.purpose
  trace @"toto1"
  expect (old_utxo_ref == purpose_utxo_ref)?
  // Check the new UTxO is sent to the swap contract
  trace @"toto2"
  expect (old_utxo.address == new_utxo.address)?
  // Check the new UTxO reference the old UTxO in its datum (to avoid double satisfaction)
  trace @"toto3"
  expect InlineDatum(new_inline_datum) = new_utxo.datum
  trace @"toto4"
  trace @"new_inline_datum:"
  trace cbor.diagnostic(new_inline_datum)
  trace @"purpose datum:"
  trace cbor.diagnostic(datum)
  expect new_utxo_datum: Datum = new_inline_datum
  trace @"toto5"
  expect (new_utxo_datum.from_utxo == Some(old_utxo_ref))?
  // Check the new UTxO still has the same owner and swap rate as the old UTxO
  expect (new_utxo_datum.owner == datum.owner)?
  expect (new_utxo_datum.swap_rate == datum.swap_rate)?
  // Check the swapped assets follow the swap price
  valid_swap_rate(old_utxo, new_utxo, datum)
}

fn valid_swap_rate(old_utxo: Output, new_utxo: Output, datum: Datum) -> Bool {
  // Extract the expected policy pair
  let ((policy_1, name_1, q1), (policy_2, name_2, q2)) = datum.swap_rate
  expect (q1 >= 0)?
  expect (q2 >= 0)?
  // Extract policies and token values from the old and new UTxOs
  expect [
    (old_policy_1, old_name_1, old_value_1),
    (old_policy_2, old_name_2, old_value_2),
  ] = value.flatten(old_utxo.value)
  expect [
    (new_policy_1, new_name_1, new_value_1),
    (new_policy_2, new_name_2, new_value_2),
  ] = value.flatten(new_utxo.value)
  // Check tokens are in the expected order
  expect and {
      policy_1 == old_policy_1,
      policy_1 == new_policy_1,
      name_1 == old_name_1,
      name_1 == new_name_1,
      policy_2 == old_policy_2,
      policy_2 == new_policy_2,
      name_2 == old_name_2,
      name_2 == new_name_2,
    }
  // Check that value changes are coherent with the swap rate
  ( new_value_1 - old_value_1 ) * q2 >= q1 * ( old_value_2 - new_value_2 )
}
