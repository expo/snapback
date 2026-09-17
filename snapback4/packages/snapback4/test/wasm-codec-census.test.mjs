// @ref LLP 3000.002#proposed-device-representation-and-codec-redesign — suite-speed wiring proof; artifact families remain a separate measurement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { census, webSources as sources, selectWebSources, mask, items, allow, refusalAllow, core, device } from './wasm-codec-census.mjs';

test('web-reachable typed JSON calls all use the codec funnel', () => {
  assert.deepEqual(census(sources()), [], 'direct serde family outside json_codec.rs');
});

test('census kills parse, encoded, MQ components and container regressions', () => {
  const file = device + 'call.rs';
  for (const [before, after] of [
    ['snapback4_core::json_codec::from_value(value)', 'serde_json::from_value(value)'],
    ['snapback4_core::json_codec::to_value(value)', 'serde_json::to_value(value)'],
    ['encoded(&components)?', 'serde_json::to_value(components).unwrap()'],
    ['request.get_mut("newIds").map(Json::take).map(parse).transpose()?.unwrap_or_default()', 'serde_json::from_value::<Vec<String>>(take(&mut request, "newIds")?).unwrap()'],
  ]) {
    const mutant = sources(); const source = mutant.get(file);
    assert.ok(source.includes(before), `missing mutant anchor: ${before}`);
    mutant.set(file, source.replace(before, after));
    const errors = census(mutant);
    assert.equal(errors.length, 1, errors.join('\n'));
    assert.match(errors[0], /call\.rs:\d+:/);
  }
});

test('allowlist binds the exact line to its sqlite function and consumes it once', () => {
  const file = core + 'fixture.rs';
  const line = 'let request = serde_json::from_str::<Json>(text)?;';
  const wrap = text => '#[cfg(feature = "sqlite")]\nfn load() {\n' + text + '\n}';
  const exceptions = [{ file, item: 'load', line }];
  const check = source => census(new Map([[file, source]]), exceptions);
  assert.deepEqual(check(wrap(line)), []);
  const changed = line.replace('Json', 'Backend');
  assert.ok(check(wrap(changed)).includes(`${file}:3: ${changed}`));
  const extra = 'serde_json::from_value(value);';
  assert.deepEqual(check(wrap(line + '\n' + extra)), [`${file}:4: ${extra}`]);
  for (const source of [wrap(''), wrap(line + '\n' + line), wrap(line).replace('load', 'other'), wrap(line).replace('sqlite', 'web')]) {
    assert.ok(check(source).some(error => error.includes('consumed')));
  }
});

test('census rejects typed imports, crate aliases, pretty writers and deserializer constructors', () => {
  for (const line of [
    'use serde_json::from_value; from_value(v);',
    'use serde_json as sj; sj::to_value(&x);',
    'extern crate serde_json as sj;',
    'use serde_json::{Value as Json, from_value as decode};',
    'serde_json::to_string_pretty(&page);',
    'serde_json::Deserializer::from_str(text);',
  ]) assert.ok(census(new Map([[device + 'fixture.rs', line]]), []).some(error => error.includes(line)), line);
});

test('census includes wire and engine read mutants', () => {
  for (const file of [core + 'wire.rs', core + 'engine/read.rs']) {
    const mutant = sources();
    assert.ok(mutant.has(file), `missing web source: ${file}`);
    mutant.set(file, mutant.get(file) + '\nfn regression() { serde_json::from_value(v); }');
    assert.ok(census(mutant).some(error => error.includes(file) && error.includes('fn regression()')));
  }
});

test('census refuses an owned decode bypassing parse on the fast route', () => {
  const mutant = sources(); const file = device + 'call.rs';
  mutant.set(file, mutant.get(file).replace('json_codec::validate_text(request)?;', 'let command = json_codec::from_value(json_codec::from_text::<Json>(request)?)?;'));
  assert.ok(census(mutant).some(error => error.includes('let command = json_codec::from_value')));
});

test('census refuses encoded reverting to an aliased owned serializer', () => {
  const mutant = sources(); const file = device + 'call.rs';
  mutant.set(file, mutant.get(file).replace('snapback4_core::json_codec::to_value(value)', '{ use serde_json::to_value as to_tree; to_tree(value) }'));
  assert.ok(census(mutant).some(error => error.includes('use serde_json::to_value as to_tree')));
});

test('module cfg declarations exclude only their files and subtrees', () => {
  const all = new Map([
    [device + 'lib.rs', '#[cfg(feature = "native")]\npub mod native;\npub mod new_device;'],
    [core + 'lib.rs', '#[cfg(feature = "sqlite")]\npub mod store;\npub mod new_core;'],
    [core + 'engine/mod.rs', '#[cfg(feature = "postgres")]\npub mod postgres;\n#[cfg(feature = "wasm-host")]\npub mod native;\npub mod read;'],
    ...[device + 'native.rs', device + 'native/child.rs', device + 'new_device.rs', core + 'store.rs', core + 'store/child.rs', core + 'new_core.rs', core + 'engine/postgres/mod.rs', core + 'engine/native.rs', core + 'engine/read.rs'].map(file => [file, '']),
  ]);
  assert.deepEqual([...selectWebSources(all).keys()], [device + 'lib.rs', core + 'lib.rs', core + 'engine/mod.rs', device + 'new_device.rs', core + 'new_core.rs', core + 'engine/read.rs']);
  all.set(core + 'lib.rs', 'pub mod store;\npub mod new_core;');
  assert.ok(selectWebSources(all).has(core + 'store/child.rs'));
  for (const file of [device + 'new_device.rs', core + 'new_core.rs', core + 'engine/read.rs']) {
    all.set(file, 'fn new_path() { serde_json::to_value(value); }');
    assert.ok(census(selectWebSources(all), []).some(error => error.startsWith(file + ':')));
  }
});

test('comments and literals are inert, dynamic envelope imports stay legal', () => {
  const source = `use serde_json::{Value as Json, json, Map, Number};
// serde_json::to_value(v)
/* outer /* nested */ serde_json::from_value(v) */
fn envelope<'a>(value: &'a Json) {
    let text = "serde_json::from_str(text)";
    let raw = r##"serde_json::Deserializer::from_str(text)"##;
    let bytes = br#"use serde_json as sj;"#;
    let escaped = "quote: \\" serde_json::to_value(v)";
    let brace = '}';
    value.to_string();
}`;
  assert.equal(mask(source).length, source.length);
  assert.deepEqual(census(new Map([[device + 'fixture.rs', source]]), []), []);
  assert.equal(census(new Map([[device + 'fixture.rs', source + '\nserde_json::to_value(v);']]), []).length, 1);
});

test('every typed entry point is refused in qualified, imported and grouped forms', () => {
  for (const name of ['from_str', 'from_slice', 'from_reader', 'from_value', 'to_string', 'to_string_pretty', 'to_vec', 'to_vec_pretty', 'to_value', 'to_writer', 'to_writer_pretty', 'Deserializer', 'Serializer', 'StreamDeserializer']) {
    for (const line of [`serde_json::${name}(v);`, `use serde_json::${name} as renamed;`, `use serde_json::{Value as Json, ${name} as renamed};`]) {
      assert.ok(census(new Map([[core + 'fixture.rs', line]]), []).some(error => error.includes(line)), line);
    }
  }
  for (const line of ['use serde_json::*;', 'use serde_json::{self as sj, Value};', 'use serde_json::{value::from_value as decode};', 'serde_json::value::from_value(v);', 'serde_json::r#from_value(v);']) {
    assert.ok(census(new Map([[core + 'fixture.rs', line]]), []).length, line);
  }
});

test('sqlite exceptions cannot move into a web function or lose their cfg', () => {
  for (const entry of allow) {
    const mutant = sources();
    const original = mutant.get(entry.file);
    assert.ok(original.includes(entry.line));
    const owner = items(original).find(item => item.kind === 'fn' && item.name === entry.item);
    const offset = original.indexOf(entry.line, owner.start);
    assert.ok(offset < owner.end);
    mutant.set(entry.file, original.slice(0, offset) + original.slice(offset + entry.line.length) + `\nfn moved() { ${entry.line} }`);
    const errors = census(mutant);
    assert.ok(errors.some(error => error.includes('fn moved()')));
    assert.ok(errors.some(error => error.includes(`exception ${entry.item} consumed 0 times`)));
  }
});


test('existing refusal exceptions are exact, function-bound and consumed once', () => {
  for (const entry of refusalAllow) {
    const source = sources().get(entry.file);
    const fixture = new Map([[entry.file, source]]);
    assert.deepEqual(census(fixture, refusalAllow.filter(other => other.file === entry.file)), []);
    for (const changed of [source.replace(entry.line, ''), source.replace(entry.line, entry.line + '\n' + entry.line), source.replace(entry.line, entry.line.replace('&error.refusal()', '&page'))]) {
      const errors = census(new Map([[entry.file, changed]]), refusalAllow.filter(other => other.file === entry.file));
      assert.ok(errors.some(error => error.includes(`exception ${entry.item} consumed`)));
    }
  }
});


test('cfg quoted in a doc attribute cannot hide a web call', () => {
  const file = core + 'fixture.rs', line = 'fn load() { serde_json::from_value(v); }';
  const source = '#[doc = "#[cfg(test)] #[cfg(feature = \"sqlite\")]" ]\n' + line;
  assert.deepEqual(census(new Map([[file, source]]), []), [`${file}:2: ${line}`]);
});

test('content representations require a decoder and cannot hide in whitespace or cfg_attr', () => {
  const file = core + 'ir.rs';
  for (const attr of ['#[serde(untagged)]', '#[ serde ( untagged ) ]', '# [ serde ( untagged ) ]', '#[serde(tag = "kind")]', '#[serde(tag = "kind", content = "data")]', '#[serde(default, flatten)]', '#[serde(rename_all(serialize = "lowercase"), untagged)]', '#[cfg_attr(feature = "web", serde(untagged))]']) {
    for (const body of [`${attr}\npub enum Added { X }`, `pub struct Added { ${attr} field: String }`]) {
      const check = derive => census(new Map([[file, `#[derive(${derive})]\n${body}`]]), []);
      assert.deepEqual(check('Serialize'), [], attr);
      assert.ok(check('Serialize, Deserialize').some(e => /content buffering.*33,460.*LLP 3000.002/.test(e)), attr);
    }
  }
  const source = sources().get(file);
  const mutant = source.replace('#[derive(Clone, Debug, PartialEq, Eq, Serialize)]\n#[serde(untagged)]\npub enum LaneSource', '#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]\n#[serde(untagged)]\npub enum LaneSource');
  assert.notEqual(mutant, source, 'restore LaneSource derived untagged decoder');
  assert.ok(census(new Map([[file, mutant]]), []).some(e => e.includes('content buffering')));
  assert.deepEqual(census(new Map([[file, '#[cfg(test)]\nmod oracle { #[derive(Deserialize)] #[serde(untagged)] enum Old { X } }']]), []), []);
});

test('representation exceptions require the exact sqlite decoder and are consumed once', async () => {
  const { representationAllow } = await import('./wasm-codec-census.mjs');
  for (const entry of representationAllow) {
    const original = sources().get(entry.file);
    const exceptions = [...allow, ...representationAllow].filter(e => e.file === entry.file);
    assert.deepEqual(census(new Map([[entry.file, original]]), exceptions), []);
    for (const changed of [original.replace(entry.line, ''), original.replace(entry.line, entry.line + '\n' + entry.line), original.replaceAll('cfg_attr(feature = "sqlite", derive(Deserialize))', 'cfg_attr(feature = "web", derive(Deserialize))'), original.replaceAll('#[cfg_attr(feature = "sqlite", derive(Deserialize))]', '#[derive(Deserialize)]\n#[cfg_attr(feature = "sqlite", derive(Deserialize))]')]) {
      assert.ok(census(new Map([[entry.file, changed]]), exceptions).some(e => e.includes(`exception ${entry.item} consumed`)));
    }
  }
});


test('the JSON funnel exception does not exempt content representations', () => {
  const source = 'fn decode() { serde_json::from_str(text) }\n#[derive(Deserialize)] #[serde(untagged)] enum Added { X }';
  const errors = census(new Map([[core + 'json_codec.rs', source]]), []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /content buffering/);
});
