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
  checkFamilies(collectFamilies([row(type, text), row('alloc::boxed::Box<snapback4_core::ir::Expr>', 'serde::private::de::missing_field::MissingFieldDeserializer<serde_json::error::Error>')]));
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

test('global family check refuses std containers and a type with only an owned family', () => {
  const good = row('snapback4_device::device::Backend', text);
  checkFamilies(collectFamilies([good, row('alloc::string::String', 'serde_json::ser::MapKeySerializer<&mut alloc::vec::Vec<u8>, serde_json::ser::CompactFormatter>', true)]));
  for (const type of ['alloc::vec::Vec<alloc::string::String>', 'snapback4_device::fixture::OnlyOwned']) {
    checkFamilies(collectFamilies([good, row(type, text), row(type, writer, true)]));
    for (const bad of [row(type, 'serde_json::value::Value'), row(type, 'serde_json::value::ser::Serializer', true)]) {
      assert.throws(() => checkFamilies(collectFamilies([good, bad])), error => error.message.includes(type));
    }
  }
});

test('visitor symbols retain their concrete Vec element and ignore non-reader helpers', () => {
  const visitor = '<alloc::vec::Vec<_> as serde_core::de::Deserialize>::deserialize::VecVisitor<alloc::string::String>';
  const symbol = reader => ({ name: `<${reader} as serde_core::de::Deserializer>::deserialize_seq::<${visitor}>`, shallow_size: 1 });
  const good = collectFamilies([symbol(text)]);
  assert.ok(good.has('alloc::vec::Vec<alloc::string::String> deserialize'));
  checkFamilies(good);
  assert.throws(() => checkFamilies(collectFamilies([symbol('serde_json::value::Value')])), /owned tree/);
  assert.equal(collectFamilies([{ name: `<${visitor} as serde_core::de::Expected>::fmt`, shallow_size: 1 }]).size, 0);
});

test('dynamic envelope exceptions cannot admit an owned typed container or decoder', () => {
  for (const type of ['serde_json::value::Value', 'serde_json::number::Number', 'alloc::string::String', '&str']) {
    checkFamilies(collectFamilies([row(type, 'serde_json::value::ser::Serializer', true)]));
    assert.throws(() => checkFamilies(collectFamilies([row(type, 'serde_json::value::Value')])), /owned tree/);
  }
  assert.throws(() => checkFamilies(collectFamilies([row('alloc::vec::Vec<alloc::string::String>', 'serde_json::value::ser::Serializer', true)])), /Vec/);
});

test('owned Value and Map reexports are readers and writers, never invisible families', () => {
  const type = 'snapback4_device::fixture::OnlyOwned';
  for (const family of ['serde_json::Value', 'serde_json::value::Value', 'serde_json::Map<alloc::string::String, serde_json::Value>', 'serde_json::map::Map<alloc::string::String, serde_json::value::Value>']) {
    for (const serialize of [false, true]) {
      const found = collectFamilies([row(type, family, serialize)]);
      assert.equal(found.size, 1, family);
      assert.throws(() => checkFamilies(found), /owned tree/);
    }
  }
});

test('content readers and visit_content helpers are named and refused', () => {
  const type = 'snapback4_core::ir::Expr';
  const visitor = `<${type} as serde_core::de::Deserialize>::deserialize::__Visitor`;
  for (const name of [
    ...['ContentDeserializer', 'ContentRefDeserializer'].map(reader => `<serde::private::de::content::${reader}<serde_json::error::Error> as serde_core::de::Deserializer>::deserialize_any::<${visitor}>`),
    `serde::private::de::content::visit_content_map::<serde_json::error::Error, ${visitor}>`,
    `serde::private::de::content::visit_content_seq::<serde_json::error::Error, ${visitor}>`,
  ]) {
    const families = collectFamilies([{ name, shallow_size: 123 }]);
    assert.equal(families.get(`${type} deserialize`).get('serde content buffer (untagged, internally tagged or flatten)'), 123);
    assert.throws(() => checkFamilies(families), /untagged.*tag =.*flatten/);
  }
});

test('only the Scan map visitor may replay the lane discriminator', () => {
  const replay = `snapback4_core::ir::lane_source::Replay<serde_json::de::MapAccess<serde_json::read::StrRead>>`;
  const symbol = type => ({ name: `<<${type} as serde_core::de::Deserialize>::deserialize::__Visitor as serde_core::de::Visitor>::visit_map::<${replay}>`, shallow_size: 17 });
  const scan = 'snapback4_core::ir::Scan';
  checkFamilies(collectFamilies([row(scan, text), symbol(scan)]));
  const other = 'snapback4_core::ir::Expr';
  assert.throws(() => checkFamilies(collectFamilies([row(scan, text), symbol(scan), symbol(other)])), /Expr deserialize.*map replay/);
});


test('the handwritten LaneSource visitor still exposes its reader', () => {
  const symbol = family => ({ name: `<${family} as serde_core::de::Deserializer>::deserialize_map::<snapback4_core::ir::lane_source::SourceVisitor>`, shallow_size: 42 });
  const families = collectFamilies([symbol(text)]);
  assert.equal(families.get('snapback4_core::ir::LaneSource deserialize').get(text), 42);
  checkFamilies(families);
  assert.throws(() => checkFamilies(collectFamilies([symbol('serde::private::de::content::ContentRefDeserializer<serde_json::error::Error>')])), /LaneSource.*content buffer/);
});
