// Read-only verification of completed qualification; never imports publish.mjs.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { json, digest, hash, member, manifest, clientManifest, verifyArtifact, validateLinux, sri } from '/Users/ccheever/sb4-pub-0453-wt/snapback4/scripts/publication-artifacts.mjs';

const kit = '/Users/ccheever/sb4-pub-0453';
const repo = '/Users/ccheever/sb4-pub-0453-wt';
const root = join(repo, 'snapback4');
const source = '9da2c76fdf32b20f985c85fe6d33b507c09edd25';
const version = '0.4.53';
const directory = join(root, 'target/publication/snapback4-darwin-arm64-0.4.53');
const report = join(root, 'reports/20261104-publication-0.4.53');
const text = path => readFileSync(path, 'utf8');
const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

assert.equal(text(join(kit, 'dry-run-1.exit')).trim(), 'done');
assert(!existsSync(join(kit, 'dry-run-1.env-invalid')));
const gate = text(join(kit, 'gate.log'));
assert.match(gate, /attempt 1 finished: done after \d+ s/);
assert(!gate.includes('ENVIRONMENT-INVALID'));
assert(!gate.includes('att=1 on battery'));
assert.equal(git(['rev-parse', 'HEAD']).trim(), source);
assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD']).trim(), 'HEAD');

const attempt = json(join(report, 'attempt-1-publication-dry-run.json'));
assert.equal(attempt.exit, 0);
assert(attempt.command.includes('--dry-run'));
assert(!attempt.command.includes('--resume'));
const log = text(join(report, 'attempt-1-publication-dry-run.log'));
const summary = [...log.matchAll(/^== 0 failure\(s\) in \d+ s$/gm)].at(-1)?.[0];
assert(summary);
const summaries = log.split('\n').filter(line => line.startsWith('-- client files:'));
assert.equal(summaries.length, 3);
assert(summaries.every(line => line.includes('; failed 0;')));
const record = JSON.parse(log.trim().split('\n').at(-1));
assert.equal(record.dry, true);
assert.equal(record.source, source);
assert.equal(record.version, version);
assert.equal(record.resume, join(directory, 'resume.json'));

const stage = json(record.resume);
assert.equal(stage.format, 3);
assert.equal(stage.source, source);
assert.equal(stage.version, version);
assert.equal(stage.qualification.suite, 'passed');
const artifacts = [stage.client, stage.expo, ...stage.platforms].map(a => verifyArtifact(a, directory, version));
assert.deepEqual(artifacts.map(a => a.name), ['snapback4', 'snapback4-expo', 'snapback4-darwin-arm64', 'snapback4-linux-x64']);
for (const a of artifacts) manifest(a.tarball, a.name, version);
clientManifest(artifacts[0].tarball, version);
const preparedDirectory = join(root, 'target/publication/client-0.4.53');
const prepared = json(join(preparedDirectory, 'prepare.json'));
assert.equal(prepared.source, source);
for (const [i, key] of [[0, 'client'], [1, 'expo']]) {
  const original = verifyArtifact(prepared[key], preparedDirectory, version);
  assert.equal(digest(original.tarball), digest(artifacts[i].tarball));
}
const [client, expo, darwin, linux] = artifacts;
const linuxReceiptPath = join(directory, linux.receiptFile);
assert.equal(linux.receiptFile, 'linux-receipt.json');
assert.equal(sri(linuxReceiptPath), linux.receiptIntegrity);
const incoming = join(root, 'target/incoming/linux-0.4.53');
assert.equal(digest(linuxReceiptPath), digest(join(incoming, 'receipt.json')));
assert.equal(digest(linux.tarball), digest(join(incoming, linux.filename)));
const linuxReceipt = validateLinux(json(linuxReceiptPath), linux.tarball, { ...client, expoIntegrity: expo.integrity }, source);
const darwinBytes = member(darwin.tarball, 'snapback4');
assert.equal(hash(darwinBytes), darwin.binarySha256);
assert.equal(darwinBytes.length, darwin.binaryBytes);
assert.equal(darwin.binaryVersion, `snapback4 ${version}`);
assert(darwin.signing.signingAuthority && darwin.signing.signingTeamId);
const darwinProof = record.artifacts.find(a => a.name === darwin.name)?.proof;
assert.equal(darwinProof?.status, 'passed');
assert.equal(darwinProof.clientIntegrity, client.integrity);
assert.equal(darwinProof.platformIntegrity, darwin.integrity);
assert.equal(darwinProof.expoIntegrity, expo.integrity);

const refreshCounts = {};
for (const tag of ['a2', 'a2d']) {
  const refresh = text(join(kit, `refresh-npm-cache-${tag}.out`));
  refreshCounts[tag] = (refresh.match(/online-resolve rc=0 prefer-offline-resolve rc=0/g) ?? []).length;
  assert.equal(refreshCounts[tag], 6);
}
const dirty = git(['status', '--porcelain', '--untracked-files=normal']).trimEnd();
assert.equal(dirty, ' M snapback4/metrics/publish.jsonl');
const metricPath = 'snapback4/metrics/publish.jsonl';
const baseline = git(['show', `${source}:${metricPath}`]);
const current = text(join(repo, metricPath));
assert(current.startsWith(baseline));
const appended = current.slice(baseline.length).trim().split('\n');
assert.equal(appended.length, 1);
assert.deepEqual(JSON.parse(appended[0]), record);

const result = {
  status: 'passed; staged only, publication not executed', verifiedAt: new Date().toISOString(),
  source, version, attempt: 1, attemptExit: attempt.exit, attemptSeconds: attempt.seconds,
  sourceSummary: summary, clientSummaries: summaries, refreshCounts, dirty,
  stage: record.resume, stageSha256: digest(record.resume), linuxReceiptSha256: digest(linuxReceiptPath),
  artifacts: artifacts.map(({ name, filename, tarball, bytes, integrity }) => ({ name, filename, bytes, integrity, sha256: digest(tarball) })),
  darwin: { binarySha256: darwin.binarySha256, binaryBytes: darwin.binaryBytes, signing: darwin.signing, proof: darwinProof },
  linux: { sourceSummary: linuxReceipt.suite.summary, frontendProofs: linuxReceipt.frontendProofs.length, starterProofs: linuxReceipt.starterProofs.length },
};
writeFileSync(join(kit, 'handoff-verified.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ...result, darwin: { ...result.darwin, proof: { status: darwinProof.status } } }, null, 2));
