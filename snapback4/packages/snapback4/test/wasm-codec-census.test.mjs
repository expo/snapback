// @ref LLP 3000.002#proposed-device-representation-and-codec-redesign — suite-speed wiring proof; artifact families remain a separate measurement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const device = 'crates/snapback4-device/src/';
const core = 'crates/snapback4-core/src/';
function walk(dir) {
  return readdirSync(root + dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(`${dir}${entry.name}/`) : [dir + entry.name]);
}
const files = [...walk(device).filter(file => !['sqlite.rs', 'ffi.rs', 'native.rs'].includes(file.slice(device.length))),
  ...['cursor.rs', 'value.rs', 'partition.rs', 'engine/runner.rs', 'engine/components.rs'].map(file => core + file)];

// Exact source lines, not type-name or whole-file exclusions. Test-module oracle
// calls, if added inside this source scope, also need an exact line and reason.
// Json/Value::to_string is the dynamic envelope's non-generic Display path and
// does not match the typed serde entry points below.
const allow = [
  { file: core + 'partition.rs', line: 'Ok(groups.into_iter().map(|group| serde_json::from_str(&group).expect("canonical")).collect())', count: 1, reason: 'groups_now is cfg(sqlite), absent from the web artifact' },
  { file: core + 'partition.rs', line: 'let group: Vec<Value> = serde_json::from_str(group).map_err(|e| RuntimeError::Store(e.to_string()))?;', count: 1, reason: 'stream is cfg(sqlite), absent from the web artifact' },
  { file: core + 'partition.rs', line: 'let group: Vec<Value> = serde_json::from_str(&event.id).map_err(|e| RuntimeError::Store(e.to_string()))?;', count: 2, reason: 'stream and expand_joins are cfg(sqlite), absent from the web artifact' },
  { file: core + 'partition.rs', line: 'let group_values: Vec<Value> = serde_json::from_str(group).map_err(|e| RuntimeError::Store(e.to_string()))?;', count: 1, reason: 'stream is cfg(sqlite), absent from the web artifact' },
];
function census(sources, exceptions = allow) {
  const used = new Map();
  const errors = [];
  for (const [file, source] of sources) {
    for (const match of source.matchAll(/serde_json\s*::\s*(?:from_str|from_slice|from_value|from_reader|to_string|to_vec|to_value|to_writer)\b/g)) {
      const start = source.lastIndexOf('\n', match.index) + 1;
      const end = source.indexOf('\n', match.index);
      const line = source.slice(start, end < 0 ? undefined : end).trim();
      const exception = exceptions.find(entry => entry.file === file && entry.line === line && entry.reason && (used.get(entry) ?? 0) < entry.count);
      if (exception) used.set(exception, (used.get(exception) ?? 0) + 1);
      else errors.push(`${file}:${source.slice(0, match.index).split('\n').length}: ${line}`);
    }
  }
  return errors;
}
const sources = () => new Map(files.map(file => [file, readFileSync(root + file, 'utf8')]));
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

test('allowlist admits only its exact dynamic envelope or test oracle line', () => {
  const file = device + 'fixture.rs';
  for (const [line, reason] of [
    ['let request = serde_json::from_str::<Json>(text)?;', 'dynamic request envelope, not a typed model'],
    ['    let oracle = serde_json::to_value(&page).unwrap();', 'plain-serde oracle inside a cfg(test) module'],
  ]) {
    const exceptions = [{ file, line: line.trim(), count: 1, reason }];
    assert.deepEqual(census(new Map([[file, line]]), exceptions), []);
    assert.equal(census(new Map([[file, line.replace('Json', 'Backend') + '\nserde_json::from_value(value)']]), exceptions).length >= 1, true);
  }
});
