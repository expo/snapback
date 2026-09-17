import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectFamilies, checkFamilies } from '../../../scripts/attribute-wasm.mjs';

const text = 'serde_json::de::Deserializer<serde_json::read::StrRead>';
const slice = 'serde_json::de::Deserializer<serde_json::read::SliceRead>';
const writer = 'serde_json::ser::Serializer<&mut alloc::vec::Vec<u8>>';
const counter = 'serde_json::ser::Serializer<&mut snapback4_core::json_codec::value_bytes::Counter>';
function row(type, family, serialize = false) {
  return { name: `<${type} as serde_core::${serialize ? 'ser::Serialize' : 'de::Deserialize'}>::${serialize ? 'serialize' : 'deserialize'}::<${family}>`, shallow_size: 1 };
}

test('family check sees nested generic names and refuses a restored owned-tree or slice decoder', () => {
  const type = 'snapback4_core::fixture::Wrapper<alloc::vec::Vec<snapback4_core::value::Value>>';
  const one = collectFamilies([row(type, text)]);
  assert.equal(one.size, 1); assert.ok(one.has(`${type} deserialize`)); checkFamilies(one);
  for (const other of ['serde_json::value::Value', slice]) {
    const two = collectFamilies([row(type, text), row(type, other)]);
    assert.throws(() => checkFamilies(two), error => error.message.includes(type) && error.message.includes(text) && error.message.includes(other === slice ? slice : 'owned tree'));
  }
  assert.throws(() => collectFamilies([row(type, 'unknown::Deserializer<u8>')]), /unrecognized serde family/);
  assert.throws(() => checkFamilies(new Map()), /no derived Snapback/);
});

test('only Value and ObjectFields may add exactly the counting writer', () => {
  for (const type of ['snapback4_core::value::Value', 'snapback4_core::value::ObjectFields']) {
    const allowed = [row(type, writer, true), row(type, counter, true)];
    checkFamilies(collectFamilies(allowed));
    assert.throws(() => checkFamilies(collectFamilies([...allowed, row(type, 'serde_json::value::ser::Serializer', true)])), /serde_json::value::ser::Serializer/);
    assert.throws(() => checkFamilies(collectFamilies([row(type, text), row(type, slice)])), /deserialize/);
  }
  const type = 'snapback4_device::device::Backend';
  assert.throws(() => checkFamilies(collectFamilies([row(type, writer, true), row(type, counter, true)])), /Backend serialize/);
});
