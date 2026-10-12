import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../../', import.meta.url));
export const device = 'crates/snapback4-device/src/';
export const core = 'crates/snapback4-core/src/';
const typed = 'from_str|from_slice|from_reader|from_value|to_string|to_string_pretty|to_vec|to_vec_pretty|to_value|to_writer|to_writer_pretty|Deserializer|Serializer|StreamDeserializer';

// Mask Rust trivia without moving offsets: diagnostics and exceptions refer to
// the original line, and braces inside strings/comments cannot change custody.
export function mask(source, strings = true) {
  const out = source.split('');
  const blank = (start, end) => { for (let i = start; i < end; i++) if (out[i] !== '\n') out[i] = ' '; };
  const literal = /(?:br|r)(#*)"[\s\S]*?"\1|b?"(?:\\[\s\S]|[^"\\])*"|b?'(?:\\(?:u\{[\da-fA-F]+\}|x[\da-fA-F]{2}|[\s\S])|[^'\\\n])'/y;
  for (let i = 0; i < source.length;) {
    const start = i;
    if (source.startsWith('//', i)) {
      i = source.indexOf('\n', i); if (i < 0) i = source.length;
    } else if (source.startsWith('/*', i)) {
      let depth = 1; i += 2;
      while (i < source.length && depth) {
        if (source.startsWith('/*', i)) { depth++; i += 2; }
        else if (source.startsWith('*/', i)) { depth--; i += 2; }
        else i++;
      }
      if (depth) throw new Error('unterminated Rust comment');
    } else {
      literal.lastIndex = i;
      const match = literal.exec(source);
      if (!match) { i++; continue; }
      i += match[0].length;
    }
    if (strings || source.startsWith('//', start) || source.startsWith('/*', start)) blank(start, i);
  }
  return out.join('');
}
function endOf(code, start, open = '{', close = '}') {
  let depth = 0;
  for (let i = start; i < code.length; i++) {
    if (code[i] === open) depth++;
    if (code[i] === close && --depth === 0) return i + 1;
  }
  throw new Error(`unclosed ${open} at ${start}`);
}
export function items(source) {
  const code = mask(source), found = [];
  for (const match of code.matchAll(/\b(fn|mod|impl|struct|enum)\s+([\w]+)[^{;]*[;{]/g)) {
    const start = match.index, brace = start + match[0].length - 1;
    // Attributes immediately preceding an item (including its visibility).
    let attributeStart = start;
    const visibility = code.slice(0, start).match(/(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?$/)[0];
    attributeStart -= visibility.length;
    while (true) {
      let end = attributeStart;
      while (end > 0 && /\s/.test(code[end - 1])) end--;
      if (code[end - 1] !== ']') break;
      let begin = end - 1, depth = 1;
      while (begin > 0 && depth) { begin--; if (code[begin] === ']') depth++; if (code[begin] === '[') depth--; }
      if (depth) break;
      while (begin > 0 && /\s/.test(code[begin - 1])) begin--;
      if (code[begin - 1] !== '#') break;
      attributeStart = begin - 1;
    }
    found.push({ name: match[2], kind: match[1], start, end: code[brace] === '{' ? endOf(code, brace) : brace + 1,
      attributeStart, attrs: mask(source.slice(attributeStart, start), false), external: code[brace] === ';' });
  }
  return found;
}
function cfgs(item) {
  const code = mask(item.attrs);
  return [...code.matchAll(/#\[\s*cfg\s*\(/g)].map(match => item.attrs.slice(match.index, code.indexOf(']', match.index) + 1));
}
function gated(item, feature) {
  return cfgs(item).some(attr => new RegExp(`^#\\[\\s*cfg\\s*\\(\\s*feature\\s*=\\s*"${feature}"\\s*\\)\\s*\\]$`).test(attr));
}
function decodeGated(item) {
  const code = mask(item.attrs);
  const derives = [...code.matchAll(/\bderive\s*\([^)]*\bDeserialize\b/g)];
  if (derives.length !== 1) return false;
  for (const match of code.matchAll(/#\s*\[/g)) {
    const end = endOf(code, code.indexOf('[', match.index), '[', ']');
    if (derives[0].index < match.index || derives[0].index >= end) continue;
    return /^#\s*\[\s*cfg_attr\s*\(\s*feature\s*=\s*"sqlite"\s*,\s*derive\s*\(\s*Deserialize\s*\)\s*\)\s*\]$/.test(item.attrs.slice(match.index, end));
  }
  return false;
}
// @ref LLP 3000.002#proposed-device-representation-and-codec-redesign — visible derives make the source census enforceable.
// Web-source policy: serde's derives cannot be renamed or re-exported, and the
// serde crate cannot be renamed; spell Deserialize/serde::Deserialize (likewise
// Serialize) so the census can see it. A buffered representation must sit beside
// a visible derive list that is fully reviewed and decoder-free, on the same item
// or macro body: a macro that supplies only the attribute or only the derive is
// refused too, because a text census cannot join a macro to its invocation.
// Procedural-macro output is outside this text census; the family check sees
// only surviving symbols, so a fully inlined content decoder escapes both and
// only the report-only byte budget remains as the final, non-blocking fallback.
function imports(tree, prefix = '') {
  const found = [];
  let start = 0, depth = 0;
  for (let i = 0; i <= tree.length; i++) {
    if (tree[i] === '{') depth++;
    if (tree[i] === '}') depth--;
    if (i !== tree.length && (tree[i] !== ',' || depth)) continue;
    const part = tree.slice(start, i).trim(); start = i + 1;
    if (!part) continue;
    const open = part.indexOf('{');
    if (open >= 0) found.push(...imports(part.slice(open + 1, part.lastIndexOf('}')), prefix + part.slice(0, open)));
    else {
      const [target, alias] = (prefix + part).replace(/\s*::\s*/g, '::').split(/\s+as\s+/);
      found.push({ target: target.trim(), renamed: alias !== undefined });
    }
  }
  return found;
}
function deriveImports(source, scopes) {
  const refused = [];
  for (const match of mask(source).matchAll(/\b(pub(?:\s*\([^)]*\))?\s+)?use\s+([^;]+);/g)) {
    if (scopes.some(item => item.attributeStart <= match.index && item.end > match.index && testOnly(item))) continue;
    for (const entry of imports(match[2])) {
      const target = entry.target.replace(/^::/, '');
      // A renamed crate hides every derive behind a name this census cannot read.
      if (entry.renamed && /^serde(?:::self)?$/.test(target)) { refused.push({ index: match.index, name: 'serde', crate: true }); continue; }
      // The derives live at serde's root; serde::de::Deserialize is the trait, which may be re-exported.
      const root = /^serde::(?:Deserialize|Serialize)$/.test(target), trait = /^serde::(?:de|ser)::(?:Deserialize|Serialize)$/.test(target);
      if ((root && (entry.renamed || match[1])) || (trait && entry.renamed)) refused.push({ index: match.index, name: target.split('::').at(-1) });
    }
  }
  for (const match of mask(source).matchAll(/\bextern\s+crate\s+serde\s+as\s+\w+\s*;/g)) {
    if (!scopes.some(item => item.attributeStart <= match.index && item.end > match.index && testOnly(item))) refused.push({ index: match.index, name: 'serde', crate: true });
  }
  return refused;
}
// The non-serde derives used by today's walked sources; a new name on a
// representation-bearing item requires review, never global alias inference.
const nonSerdeDerives = new Set(['Clone', 'Copy', 'Debug', 'Default', 'Hash', 'PartialEq', 'Eq', 'PartialOrd', 'Ord', 'Error']);
function classifyDerives(attrs) {
  const names = derives(attrs);
  // `hidden`: serde attributes do not compile without a serde derive, so a representation with no
  // visible derive gets one from a macro (or gives one to a macro's argument) this census cannot join.
  return { decoder: names.some(name => ['Deserialize', 'serde::Deserialize'].includes(name)), hidden: names.length === 0,
    unknown: names.filter(name => !['Deserialize', 'serde::Deserialize', 'Serialize', 'serde::Serialize'].includes(name) && !nonSerdeDerives.has(name)) };
}
function derives(attrs) {
  return [...mask(attrs).matchAll(/\bderive\s*\(([^)]*)\)/g)].flatMap(m => m[1].split(',').map(s => s.trim().replace(/\s*::\s*/g, '::').replace(/^::/, '')).filter(Boolean));
}
function bufferedAttrs(code, begin, finish) {
  const found = [];
  for (const match of code.slice(begin, finish).matchAll(/#\s*\[/g)) {
    const start = begin + match.index, end = endOf(code, code.indexOf('[', start), '[', ']');
    const attr = code.slice(start, end);
    if ([...attr.matchAll(/\bserde\s*\(/g)].some(match => {
      const open = attr.indexOf('(', match.index), end = endOf(attr, open, '(', ')');
      return /(?:^|,)\s*(?:untagged\b|flatten\b|tag\s*=)/.test(attr.slice(open + 1, end - 1));
    })) found.push(start);
  }
  return found;
}
function representations(source, scopes) {
  const code = mask(source), found = [], macros = [];
  for (const match of code.matchAll(/\bmacro_rules!\s*(\w+)\s*([{([])/g)) {
    const open = match.index + match[0].length - 1;
    const end = endOf(code, open, match[2], { '{': '}', '(': ')', '[': ']' }[match[2]]);
    const item = { name: match[1], kind: 'macro', attributeStart: match.index, start: match.index, end, attrs: '' };
    macros.push(item);
    const { decoder, unknown, hidden } = classifyDerives(code.slice(open, end));
    if (decoder || unknown.length || hidden) {
      for (const index of bufferedAttrs(code, open, end)) found.push({ index, item, unknown, decoder, hidden });
    }
  }
  for (const item of scopes.filter(item => ['enum', 'struct'].includes(item.kind))) {
    if (macros.some(m => m.start <= item.start && m.end >= item.end)) continue;
    const { decoder, unknown, hidden } = classifyDerives(item.attrs), buffered = bufferedAttrs(code, item.attributeStart, item.end);
    if (decoder || unknown.length || hidden) {
      for (const index of buffered) found.push({ index, item, unknown, decoder, hidden });
    }
  }
  return found;
}
function testOnly(item) { return cfgs(item).some(attr => /^#\[\s*cfg\s*\(\s*test\s*\)\s*\]$/.test(attr)); }
function walk(dir) {
  return readdirSync(root + dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(`${dir}${entry.name}/`) : entry.name.endsWith('.rs') ? [dir + entry.name] : []);
}
export function webSources() {
  const all = new Map([...walk(device), ...walk(core)].sort().map(file => [file, readFileSync(root + file, 'utf8')]));
  return selectWebSources(all);
}
export function selectWebSources(all) {
  const excluded = [];
  for (const file of [device + 'lib.rs', core + 'lib.rs', core + 'engine/mod.rs']) {
    assertSource(all, file);
    for (const item of items(all.get(file)).filter(item => item.kind === 'mod' && item.external)) {
      if (!['sqlite', 'native', 'wasm-host', 'postgres'].some(feature => gated(item, feature))) continue;
      const stem = path.posix.dirname(file) + '/' + item.name;
      excluded.push(stem + '.rs', stem + '/');
    }
  }
  return new Map([...all].filter(([file]) => !excluded.some(exclude => exclude.endsWith('/') ? file.startsWith(exclude) : file === exclude)));
}
function assertSource(all, file) { if (!all.has(file)) throw new Error(`missing module declaration source: ${file}`); }

// Every exception is an exact line in a named enclosing function and a sqlite
// item (possibly its impl). Moving the line, lifting cfg, or deleting it is red.
export const allow = [
  { file: core + 'partition.rs', item: 'groups_now', line: 'Ok(groups.into_iter().map(|group| serde_json::from_str(&group).expect("canonical")).collect())' },
  // Retirement of the duplicate oversized-sync path returned these exact
  // calls to `stream`; their named owner must still be sqlite-only.
  { file: core + 'partition.rs', item: 'stream', line: 'let group: Vec<Value> = serde_json::from_str(group).map_err(|e| RuntimeError::Store(e.to_string()))?;' },
  // F2 moved the held-join certification from `stream` into `expand_joins`,
  // which reuses the group it already parsed; one sqlite-only call remains.
  { file: core + 'partition.rs', item: 'expand_joins', line: 'let group: Vec<Value> = serde_json::from_str(&event.id).map_err(|e| RuntimeError::Store(e.to_string()))?;' },
  { file: core + 'partition.rs', item: 'stream', line: 'let group_values: Vec<Value> = serde_json::from_str(group).map_err(|e| RuntimeError::Store(e.to_string()))?;' },
  { file: core + 'engine/receipt.rs', item: 'from_receipt', line: 'let body: Json = serde_json::from_str(text).map_err(|e| RuntimeError::Store(e.to_string()))?;' },
  { file: core + 'engine/receipt.rs', item: 'from_receipt', line: 'let mut why: Refusal = serde_json::from_value(body["why"].clone()).map_err(|e| RuntimeError::Store(e.to_string()))?;' },
  { file: core + 'engine/mod.rs', item: 'open_selected_at', line: 'let schema = serde_json::from_str(&schema).map_err(|e| RuntimeError::decode(e, |e| RuntimeError::Store(format!("invalid stored schema: {e}"))))?;' },
  { file: core + 'engine/mod.rs', item: 'open_selected_at', line: 'let programs = serde_json::from_str(&programs).map_err(|e| RuntimeError::Store(format!("invalid stored programs: {e}")))?;' },
  // Release extraction moved activate into the sqlite-gated activation module;
  // selectWebSources excludes that module and lifting its gate restores the scan.
  { file: core + 'engine/mod.rs', item: 'mutate', line: 'tx.record_applied(&viewer, op, seq, &serde_json::to_string(&outcome.receipt(Some(op))).map_err(|e| RuntimeError::Store(e.to_string()))?)?;' },
];
export const representationAllow = [
  // The symbol-bearing web build has zero decoder symbols for these server replies.
  // Deserialize is sqlite-only; serialization and the wire shape remain shared.
  { file: core + 'engine/mod.rs', item: 'WriteState', line: '#[serde(tag = "state", rename_all = "lowercase")]' },
  { file: core + 'engine/mod.rs', item: 'MutationOutcome', line: '#[serde(flatten)]' },
];
// Existing refusal envelopes also use the funnel; pin their exact custody
// until their product routing can change independently of this instrument.
export const refusalAllow = [
  { file: device + 'call.rs', item: 'answer', line: 'Err(error) => json!({ "denied": snapback4_core::json_codec::to_value(&error.refusal()).expect("a refusal is serializable") }),' },
  { file: device + 'call.rs', item: 'call', line: 'Err(error) if error.is_refusal() => json!({ "denied": snapback4_core::json_codec::to_value(&error.refusal()).expect("a refusal is serializable") }),' },
  { file: device + 'web.rs', item: 'refused', line: 'JsError::new(&json!({ "denied": snapback4_core::json_codec::to_value(&error.refusal()).expect("a refusal is serializable") }).to_string())' },
];
// Exact streaming entry points inherited from the integrated engine: the file
// verifier discards JSON without constructing a value; the stored-row meter
// counts serializer bytes without allocating a second row or text buffer.
// Their custody and single-use checks remain as strict as the other entries.
export const streamingAllow = [
  { file: core + 'assets.rs', item: 'verify_file', line: '"application/json" => text(bytes).is_some_and(|text| serde_json::from_str::<serde::de::IgnoredAny>(text).is_ok()),' },
];
export function census(sources, exceptions = [...allow, ...refusalAllow, ...representationAllow, ...streamingAllow]) {
  const used = new Map(exceptions.map(entry => [entry, 0])), errors = [];
  for (const [file, source] of sources) {
    const code = mask(source), scopes = items(source), hits = new Set();
    for (const { index, name, crate } of deriveImports(source, scopes)) errors.push(`${file}:${source.slice(0, index).split('\n').length}: serde derive import policy refuses ${crate ? 'renaming the serde crate' : `renaming or re-exporting ${name}`} in web-reachable sources; spell the derive ${crate ? 'Deserialize or Serialize' : name} (or serde::${crate ? 'Deserialize' : name}) so the census can see it`);
    const reps = representations(source, scopes);
    for (const { index } of reps) hits.add(index);
    if (file !== core + 'json_codec.rs') {
      for (const match of code.matchAll(new RegExp(`\\bserde_json\\s*::\\s*(?:(?:value|de|ser)\\s*::\\s*)?(?:r#)?(?:${typed})\\b`, 'g'))) hits.add(match.index);
      // Reject typed import trees, glob imports, and crate aliases at their use
      // item. Value/Map/Number/json imports (including aliases) stay legal.
      for (const match of code.matchAll(/\b(?:use\s+[\s\S]*?;|extern\s+crate\s+serde_json\s+as\s+\w+\s*;)/g)) {
        if (/\bserde_json\b/.test(match[0]) && (new RegExp(`\\b(?:${typed})\\b|\\*`).test(match[0]) || /\b(?:serde_json|self)\s+as\b/.test(match[0]))) {
          for (const hit of hits) if (hit >= match.index && hit < match.index + match[0].length) hits.delete(hit);
          hits.add(match.index);
        }
      }
      if (file.startsWith(device)) {
        for (const match of code.matchAll(/\bjson_codec\s*::\s*(?:r#)?(from_value|to_value)\b/g)) {
          const fn = scopes.filter(item => item.kind === 'fn' && item.start < match.index && item.end > match.index).at(-1);
          if (file !== device + 'call.rs' || fn?.name !== (match[1] === 'from_value' ? 'parse' : 'encoded')) hits.add(match.index);
        }
        for (const match of code.matchAll(/\buse\s+[^;]*\bjson_codec\b[^;]*;/g)) {
          if (/\b(?:from_value|to_value)\b|\*|\b(?:json_codec|self)\s+as\b/.test(match[0])) hits.add(match.index);
        }
      }
    }
    for (const index of [...hits].sort((a, b) => a - b)) {
      const representation = reps.find(hit => hit.index === index);
      const enclosing = scopes.filter(item => item.attributeStart <= index && item.end > index);
      if (enclosing.some(testOnly)) continue;
      const fn = enclosing.filter(item => item.kind === 'fn').at(-1);
      const start = source.lastIndexOf('\n', index) + 1, end = source.indexOf('\n', index);
      const line = source.slice(start, end < 0 ? undefined : end).trim();
      const exception = exceptions.find(entry => entry.file === file && entry.item === (representation?.item.name ?? fn?.name) && entry.line === line && (enclosing.some(item => gated(item, 'sqlite')) || refusalAllow.includes(entry) || streamingAllow.includes(entry) || (representation && decodeGated(representation.item))));
      if (exception) used.set(exception, used.get(exception) + 1);
      else errors.push(`${file}:${source.slice(0, index).split('\n').length}: ${line}${representation?.unknown?.length ? ` — unresolvable derive ${representation.unknown.join(', ')}: not on the census's reviewed list; if it is not a decoder add it to nonSerdeDerives in wasm-codec-census.mjs` : ''}${representation?.hidden ? ' — a serde representation with no visible derive: the derive comes from, or goes to, a macro this census cannot join; put the derive and the attribute on the same item' : ''}${representation && (representation.decoder || representation.hidden || representation.unknown?.length) ? ` — ${representation.decoder ? 'Deserialize content buffering' : 'if that derive decodes, content buffering follows'}: on a decoded type this representation selects serde's content buffer, which instantiates every reachable reader again (ir::LaneSource cost 33,460 B gzip this way); see LLP 3000.002#proposed-device-representation-and-codec-redesign` : ''}`);
    }
  }
  for (const [entry, count] of used) if (count !== 1) errors.push(`${entry.file}: exception ${entry.item} consumed ${count} times (expected 1): ${entry.line}`);
  return errors;
}
