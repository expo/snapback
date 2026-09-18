// S3 evidence only. No metric append, no browser failure masked by a Node run.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, launchUnicode } from './lib.mjs';

// This function also runs verbatim in Chromium. Every comparison goes through
// the wasm export used by tokens, or through the real interpreter's lower().
export function compareUnicode({ fixture, backend, ages, version, timingOnly = false }) {
  const { WebDevice } = globalThis.unicodeRuntime;
  const age = char => {
    const cp = char.codePointAt(0), range = ages.find(([lo, hi]) => cp >= lo && cp <= hi);
    return { point: `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`, age: range?.[2] ?? 'unassigned in 17.0.0' };
  };
  const device = new WebDevice(JSON.stringify(backend), '[]');
  const call = request => {
    const reply = JSON.parse(device.call(JSON.stringify(request)));
    if (!('ok' in reply)) throw new Error(JSON.stringify(reply));
    return reply.ok;
  };
  const compareVersion = (a, b) => {
    const left = a.split('.').map(Number), right = b.split('.').map(Number);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      const delta = (left[i] ?? 0) - (right[i] ?? 0);
      if (delta) return delta;
    }
    return 0;
  };
  const differences = [];
  let folds = 0, lowers = 0, lowerRefusals = 0;
  try {
    if (!timingOnly) for (const row of fixture.cases) {
      const lower = call({ op: 'query', name: 'lowerText', viewer: 'alice', args: { s: row.input } });
      if ((lower.denied?.code ?? null) !== row.lowerRefusal) throw new Error(`lower admission disagrees at ${row.source}: ${JSON.stringify(lower)}`);
      const actual = { fold: WebDevice.word_fold(row.input), lower: lower.data };
      folds++;
      if (row.lowerRefusal) lowerRefusals++; else lowers++;
      for (const kind of row.lowerRefusal ? ['fold'] : ['fold', 'lower']) if (actual[kind] !== row[kind]) {
        const points = value => [...new Set([...value])].map(age);
        const versions = kind === 'fold' ? [fixture.normalizationUnicode, fixture.rustUnicode] : [fixture.rustUnicode];
        const older = version.unicode ? [version.unicode, ...versions].sort(compareVersion)[0] : null;
        const inputAges = [...row.input].map(char => age(char).age);
        const knownNewer = older && inputAges.some(a => !a.startsWith('unassigned') && compareVersion(a, older) > 0);
        const newerInput = !older ? null : knownNewer ? true : inputAges.some(a => a.startsWith('unassigned')) ? null : false;
        differences.push({ kind, source: row.source, input: row.input, expected: row[kind], actual: actual[kind], inputPoints: points(row.input), expectedPoints: points(row[kind]), actualPoints: points(actual[kind]), olderUnicode: older, containsInputAssignedAfterOlder: newerInput });
      }
    }
  } finally { device.free(); }
  const timings = {};
  for (const [kind, body] of [['ascii', 'COFFEE message THE QUICK brown fox'], ['unicode', 'CAFE\u0301 ΟΣ İ 𐐀 message']]) {
    const request = JSON.stringify({ op: 'apply', first: true, page: { snapshot: true, events: Array.from({ length: 4000 }, (_, n) => ({ table: 'notes', kind: 'put', id: `n${String(n).padStart(5, '0')}`, data: { id: `n${String(n).padStart(5, '0')}`, body: `${body} ${n}` } })), watermark: 1, generation: 1, more: false } });
    const samples = [];
    for (let run = 0; run < 9; run++) {
      const d = new WebDevice(JSON.stringify(backend), '[]');
      try {
        const start = performance.now(), reply = JSON.parse(d.call(request)), elapsed = performance.now() - start;
        if (!reply.ok || reply.denied) throw new Error(JSON.stringify(reply));
        const changes = JSON.parse(d.drain());
        if (changes.filter(c => c.s === 'r').length !== 4000) throw new Error('page apply did not keep all 4000 rows');
        if (run >= 2) samples.push(+elapsed.toFixed(3));
      } finally { d.free(); }
    }
    timings[kind] = { rows: 4000, warmups: 2, samplesMs: samples, medianMs: [...samples].sort((a,b) => a-b)[3] };
  }
  return { witness: 'unicode-fold', version, agePolicy: 'NFC stability applies to assigned input; case mappings have no equivalent stability guarantee', normalizationUnicode: fixture.normalizationUnicode, rustUnicode: fixture.rustUnicode, normalizationLines: fixture.normalizationLines, folds, lowers, lowerRefusals, differenceCount: differences.length, differences, timings };
}

export async function unicodeWitness(args) {
  let node = false, artifact, timingOnly = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--node') node = true;
    else if (args[i] === '--timing-only') timingOnly = true;
    else if (args[i] === '--artifact' && args[i + 1]) artifact = resolve(args[++i]);
    else throw new Error(`unknown Unicode witness option: ${args[i]}`);
  }
  if (process.versions.node.split('.')[0] !== '24') throw new Error('Unicode witness requires Node 24');
  const run = (cmd, argv) => {
    const result = spawnSync(cmd, argv, { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] });
    if (result.error || result.status !== 0) throw new Error(`${cmd} ${argv.join(' ')} failed: ${result.error ?? result.status}`);
  };
  run('cargo', ['test', '-p', 'snapback4-core', '--test', 'unicode_fold', '--', '--nocapture']);
  run('cargo', ['test', '-p', 'snapback4-device', '--test', 'unicode', '--', '--nocapture']);
  if (!artifact) {
    run('bash', ['scripts/build-wasm.sh']);
    artifact = join(root, 'packages/snapback4/src/wasm/snapback4_device.js');
  }
  const wasm = artifact.endsWith('snapback4_device.js') ? artifact.replace(/\.js$/, '_bg.wasm') : artifact.replace(/\.js$/, '.wasm');
  const fixture = JSON.parse(readFileSync(join(root, 'target/unicode-fold.json'), 'utf8'));
  const backend = JSON.parse(readFileSync(join(root, 'target/unicode-device.json'), 'utf8'));
  const ages = readFileSync(join(root, 'crates/snapback4-core/tests/fixtures/unicode-17.0.0/DerivedAge.txt'), 'utf8').split('\n').flatMap(line => {
    line = line.split('#')[0].trim();
    if (!line) return [];
    const [range, age] = line.split(';').map(s => s.trim()), [lo, hi = lo] = range.split('..').map(s => parseInt(s, 16));
    return [[lo, hi, age]];
  });
  let result;
  if (node) {
    globalThis.unicodeRuntime = await import(pathToFileURL(artifact).href);
    globalThis.unicodeRuntime.initSync({ module: readFileSync(wasm) });
    result = compareUnicode({ fixture, backend, ages, timingOnly, version: { host: 'Node (supplemental; not Chromium evidence)', node: process.version, v8: process.versions.v8, icu: process.versions.icu, unicode: process.versions.unicode } });
  } else {
    const browser = await launchUnicode({ glue: readFileSync(artifact).toString('base64'), bytes: readFileSync(wasm).toString('base64') });
    try { result = await browser.page.evaluate(compareUnicode, { fixture, backend, ages, timingOnly, version: browser.version }); }
    finally { await browser.close(); }
  }
  console.log(JSON.stringify(result));
  // Differences are evidence, but they must never look like a green parity test.
  if (result.differenceCount) process.exitCode = 1;
}
