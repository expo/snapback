#!/usr/bin/env node
// @ref LLP 3000.002#proposed-device-representation-and-codec-redesign — measure instantiated code before choosing the next diet rung.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
function refuse(message) { throw new Error(message); }
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) refuse(`${command} ${args.join(' ')} failed: ${result.error?.message ?? result.stderr ?? result.status}`);
  return result.stdout;
}


function concrete(name, prefix) {
  const start = name.indexOf(prefix);
  if (start < 0) return undefined;
  let depth = 1;
  for (let i = start + prefix.length; i < name.length; i++) {
    if (name[i] === '<') depth++;
    if (name[i] === '>' && --depth === 0) return name.slice(start, i + 1);
  }
  refuse(`unclosed concrete type in symbol: ${name}`);
}
const clean = name => name.replace(/\[[0-9a-f]{8,}\]/g, '');

// Walk backwards from the trait boundary, balancing generic arguments. A
// `[^<>]*` type pattern silently misses generic Snapback types.
export function derivedTypes(name) {
  const found = [];
  for (const match of name.matchAll(/ as serde_core::(de::Deserialize|ser::Serialize)>/g)) {
    let depth = 0;
    for (let i = match.index - 1; i >= 0; i--) {
      if (name[i] === '>') depth++;
      if (name[i] !== '<') continue;
      if (depth-- !== 0) continue;
      const type = name.slice(i + 1, match.index);
      if (/^snapback4_(core|device)::/.test(type)) found.push({ type, direction: match[1] === 'ser::Serialize' ? 'serialize' : 'deserialize' });
      break;
    }
  }
  return found;
}

export function collectFamilies(kept) {
  const families = new Map();
  for (const r of kept) {
    const n = clean(r.name);
    if (/::__Field(?:Visitor)?/.test(n)) continue; // Field-name visitors are adapters inside a family.
    for (const { type, direction } of derivedTypes(n)) {
      let family;
      if (direction === 'deserialize') {
        family = n.includes('serde_json::read::StrRead') ? 'serde_json::de::Deserializer<serde_json::read::StrRead>' : n.includes('serde_json::read::SliceRead') ? 'serde_json::de::Deserializer<serde_json::read::SliceRead>' : concrete(n, 'serde_json::de::Deserializer<') ?? (/serde_json::(?:value|map)::/.test(n) ? 'serde_json::Value/Map (owned tree)' : undefined);
      } else {
        family = n.includes('serde_json::value::ser::Serializer') ? 'serde_json::value::ser::Serializer' : concrete(n, 'serde_json::ser::Serializer<');
      }
      if (!family) {
        // A derived entry can be fully inlined; its non-generic helper is
        // not another family. Refuse an unfamiliar *concrete* serde type.
        if (/serde_json::.*(?:Serializer|Deserializer|Read)|::(?:serialize|deserialize)::<.*(?:Serializer|Deserializer)/.test(n)) refuse(`unrecognized serde family: ${n}`);
        continue;
      }
      const key = `${type} ${direction}`;
      if (!families.has(key)) families.set(key, new Map());
      const found = families.get(key); found.set(family, (found.get(family) ?? 0) + r.shallow_size);
    }
  }
  return families;
}

// The allocation-free output meter intentionally adds exactly this writer to
// these two types. It does not excuse a third family or any deserializer.
const countingFamilies = new Set([
  'serde_json::ser::Serializer<&mut alloc::vec::Vec<u8>>',
  'serde_json::ser::Serializer<&mut snapback4_core::json_codec::value_bytes::Counter>',
]);
const allowed = new Set(['snapback4_core::value::Value serialize', 'snapback4_core::value::ObjectFields serialize']);
export function checkFamilies(families) {
  if (!families.size) refuse('no derived Snapback serde families found in the symbol-bearing artifact');
  const duplicates = [...families].filter(([type, found]) => found.size > 1 && !(allowed.has(type) && found.size === countingFamilies.size && [...found.keys()].every(f => countingFamilies.has(f))));
  if (duplicates.length) refuse(duplicates.map(([type, found]) => `${type}: ${[...found.keys()].join(', ')}`).join('\n'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) try {
  if (Number(process.versions.node.split('.')[0]) !== 24) refuse('Node 24 required; export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH');
  if (args.some(a => !['--families', '--check-families'].includes(a))) refuse('usage: node scripts/attribute-wasm.mjs [--families] [--check-families]');
  const twiggy = spawnSync('twiggy', ['--version'], { encoding: 'utf8' });
  if (twiggy.error || twiggy.status !== 0) refuse('twiggy is required: cargo install twiggy --version 0.8.0 --locked');
  if (!run('rustup', ['target', 'list', '--installed']).split(/\s+/).includes('wasm32-unknown-unknown')) refuse('wasm target is required: rustup target add wasm32-unknown-unknown');
  run('cargo', ['build', '-p', 'snapback4-device', '--no-default-features', '--features', 'web', '--profile', 'wasm', '--target', 'wasm32-unknown-unknown', '--target-dir', 'target/wasm-sym'], { env: { ...process.env, CARGO_PROFILE_WASM_STRIP: 'none' }, stdio: ['ignore', 'inherit', 'inherit'] });
  const rows = JSON.parse(run('twiggy', ['top', '-n', '1000000', '--format', 'json', path.join(root, 'target/wasm-sym/wasm32-unknown-unknown/wasm/snapback4_device.wasm')]));
  if (!Array.isArray(rows) || rows.length === 0 || rows.length >= 1000000 || rows.some(r => typeof r.name !== 'string' || !Number.isSafeInteger(r.shallow_size))) refuse('twiggy returned an incomplete or invalid item table');
  const kept = rows.filter(r => !/^custom section '(?:\.debug[^']*|name)'/.test(r.name) && !r.name.startsWith('"'));
  const classes = new Map(['serde deserialize', 'serde serialize', 'serde_json own code', 'std generics over Snapback types', 'B-trees over std-only types', 'snapback4-core own code', 'snapback4-device own code', '.rodata', 'everything else'].map(c => [c, 0]));
  function classify(n) {
    if (n.startsWith('data segment') && n.includes('.rodata')) return '.rodata';
    if (/serde_json|serde_core|serde::/.test(n)) {
      if (/Deserializ|::de::|Visitor/.test(n)) return 'serde deserialize';
      if (/Serializ|::ser::/.test(n)) return 'serde serialize';
      return 'serde_json own code';
    }
    if (/snapback4_(core|device)/.test(n)) {
      if (/^<?(alloc|core)::|btree/.test(n)) return 'std generics over Snapback types';
      return n.includes('snapback4_core') ? 'snapback4-core own code' : 'snapback4-device own code';
    }
    if (n.includes('btree')) return 'B-trees over std-only types';
    return 'everything else';
  }
  const total = kept.reduce((sum, r) => { const c = classify(clean(r.name)); classes.set(c, classes.get(c) + r.shallow_size); return sum + r.shallow_size; }, 0);
  const lines = ['Shallow bytes; debug/name sections excluded (symbol-bearing pre-bindgen module).', '       bytes   share  class'];
  for (const [c, size] of classes) lines.push(`${String(size).padStart(12)} ${(100 * size / total).toFixed(2).padStart(6)}%  ${c}`);
  lines.push(`${total} total attributed bytes`);
  lines.push(`${kept.filter(r => r.name.startsWith('custom section')).reduce((sum, r) => sum + r.shallow_size, 0)} B non-debug custom metadata included in everything else`);
  const trees = kept.filter(r => /btree|BTreeMap|BTreeSet/.test(r.name));
  const sorts = kept.filter(r => /slice.*sort/.test(r.name));
  for (const [name, items] of [['BTreeMap/BTreeSet', trees], ['slice-sort', sorts]]) lines.push(`${name}: ${items.reduce((s, r) => s + r.shallow_size, 0)} B; ${new Set(items.map(r => clean(r.name))).size} distinct generic items`);
  lines.push('25 largest generic instantiations:');
  for (const r of kept.filter(r => r.name.includes('::<') || r.name.startsWith('<')).sort((a,b) => b.shallow_size - a.shallow_size).slice(0,25)) lines.push(`${r.shallow_size} B  ${clean(r.name)}`);
  if (args.includes('--families') || args.includes('--check-families')) {
    const families = collectFamilies(kept);
    if (!families.size) refuse('no derived Snapback serde families found in the symbol-bearing artifact');
    lines.push('Derived serde family census (surviving symbols, shallow bytes; inlined bodies have no independent size):');
    for (const [key, found] of [...families].sort(([a],[b]) => a.localeCompare(b))) lines.push(`${found.size > 1 ? 'DUPLICATE ' : ''}${key}: ${[...found].map(([f,b]) => `${f} (${b} B)`).join(', ')}`);
    if (args.includes('--check-families')) { checkFamilies(families); lines.push('serde family check: ok'); }
    const clones = kept.filter(r => /snapback4_core.*::ir::/.test(r.name) && /clone/i.test(r.name));
    lines.push(`IR clone symbols: ${clones.length}, ${clones.reduce((s,r) => s + r.shallow_size,0)} B`);
    for (const r of clones) lines.push(`${r.shallow_size} B  ${clean(r.name)}`);
  }
  console.log(lines.join('\n'));
} catch (error) { console.error(`attribute-wasm: ${error.message}`); process.exitCode = 1; }
