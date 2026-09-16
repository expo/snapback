import { createHash } from 'node:crypto';
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { isDeepStrictEqual } from 'node:util';
import { scaleActions, expectedEnvelope, PROFILES } from './scale.mjs';
import { starterActions } from './starter.mjs';
import { ReportReducer } from './reducer.mjs';
import { loadMedia } from './services.mjs';
import { sha256, line, insist } from './common.mjs';
import { validateAction } from './actions.mjs';

async function fileDigest(path) {
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(path)) { hash.update(chunk); bytes += chunk.length; }
  return { sha256: hash.digest('hex'), bytes };
}
export async function generate({ profile = 'tiny', directory }) {
  const starter = ['starter', 'conformance'].includes(profile);
  insist(starter || PROFILES[profile], 'UNKNOWN_PROFILE');
  await mkdir(directory, { recursive: true });
  const assets = await loadMedia(), reducer = starter ? null : new ReportReducer(assets);
  const hash = createHash('sha256'); let bytes = 0, records = 0;
  const milestones = {}, operations = {};
  function* chunks() {
    for (const action of starter ? starterActions({ conformance: profile === 'conformance' }) : scaleActions(profile)) {
      validateAction(action, ++records); reducer?.apply(action);
      milestones[action.milestone] = (milestones[action.milestone] ?? 0) + 1;
      operations[action.op] = (operations[action.op] ?? 0) + 1;
      const chunk = Buffer.from(line(action)); hash.update(chunk); bytes += chunk.length; yield chunk;
    }
  }
  const file = 'actions.ndjson.gz';
  // Streaming, exclusive output creation: never materialize the full log or overwrite an earlier run.
  await pipeline(Readable.from(chunks()), createGzip({ level: 9, mtime: 0 }), createWriteStream(join(directory, file), { flags: 'wx' }));
  const report = reducer?.report() ?? null;
  if (report) {
    insist(isDeepStrictEqual({ large: report.large, total: report.total }, expectedEnvelope(profile)), 'ENVELOPE_MISMATCH');
    await writeFile(join(directory, 'expected-report.json'), line(report), { flag: 'wx' });
  }
  const manifest = { version: 1, profile, records, milestones, operations,
    actions: { file, sha256: hash.digest('hex'), bytes, compressed: await fileDigest(join(directory, file)) },
    media: assets.map(({ id, sha256, bytes }) => ({ id, sha256, bytes })),
    envelope: report ? { large: report.large, total: report.total } : null,
    report: report ? { file: 'expected-report.json', sha256: sha256(line(report)) } : null };
  await writeFile(join(directory, 'manifest.json'), line(manifest), { flag: 'wx' });
  return manifest;
}

export async function verifyGenerated(directory) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  insist(manifest.version === 1 && manifest.actions.file === 'actions.ndjson.gz', 'INVALID_MANIFEST');
  insist(isDeepStrictEqual(await fileDigest(join(directory, manifest.actions.file)), manifest.actions.compressed), 'COMPRESSED_HASH_MISMATCH');
  const source = createReadStream(join(directory, manifest.actions.file)), unzip = createGunzip();
  source.on('error', error => unzip.destroy(error)); source.pipe(unzip);
  const hash = createHash('sha256'); let bytes = 0, records = 0;
  const tap = new Transform({ transform(chunk, encoding, done) { hash.update(chunk); bytes += chunk.length; done(null, chunk); } });
  unzip.on('error', error => tap.destroy(error)); unzip.pipe(tap);
  const reducer = ['starter', 'conformance'].includes(manifest.profile) ? null : new ReportReducer(await loadMedia());
  for await (const text of createInterface({ input: tap, crlfDelay: Infinity })) {
    const action = JSON.parse(text); validateAction(action, ++records); reducer?.apply(action);
  }
  insist(records === manifest.records && bytes === manifest.actions.bytes && hash.digest('hex') === manifest.actions.sha256, 'ACTION_HASH_MISMATCH');
  if (reducer) {
    const reportBytes = await readFile(join(directory, 'expected-report.json'));
    insist(sha256(reportBytes) === manifest.report.sha256, 'REPORT_HASH_MISMATCH');
    insist(isDeepStrictEqual(reducer.report(), JSON.parse(reportBytes)), 'REPORT_REDUCTION_MISMATCH');
    insist(isDeepStrictEqual(manifest.envelope, expectedEnvelope(manifest.profile)), 'ENVELOPE_MISMATCH');
  }
  return { verified: true, records, sha256: manifest.actions.sha256 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, profileOrDir, directory] = process.argv.slice(2);
  insist(command === 'verify' || command === 'generate' && directory, 'USAGE: generate.mjs generate tiny|full|starter|conformance OUT_DIR | verify OUT_DIR');
  console.log(JSON.stringify(command === 'verify' ? await verifyGenerated(profileOrDir) : await generate({ profile: profileOrDir, directory }), null, 2));
}
