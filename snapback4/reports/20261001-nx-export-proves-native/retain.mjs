import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { inventory, hash } from '../../crates/snapback4/src/verbs/witness/payload.mjs';
const report = path.dirname(new URL(import.meta.url).pathname);
const retained = [];
for (const file of fs.readdirSync(report).filter(n => /^(?:(?:plain|social)-(?:cold|warm[1-5]|native-change|native-remove|startup-throw|missing-runtime)|plain-fresh-first-export|social-before-asset-fix-cold|social-recovery-warm|social-idle-warm)\.json$/.test(n))) {
  const sample = JSON.parse(fs.readFileSync(path.join(report, file)));
  if (!sample.receiptPath || !fs.existsSync(sample.receiptPath)) continue;
  const source = path.dirname(sample.receiptPath), name = file.slice(0, -5), destination = path.join(report, 'evidence', name);
  fs.mkdirSync(destination, { recursive: true });
  const receipt = JSON.parse(fs.readFileSync(sample.receiptPath));
  if (fs.existsSync(path.join(source, 'build.json'))) {
    const build = JSON.parse(fs.readFileSync(path.join(source, 'build.json')));
    if (inventory(build.executedApp.path).sha256 !== build.executedApp.inventory.sha256) throw Error(`app changed: ${name}`);
    if (sample.bundleHash !== build.executedApp.javascript.sha256) throw Error(`export mismatch: ${name}`);
    if (receipt.exitStatus === 0) {
      const rows = fs.readFileSync(path.join(source, 'smoke-ios-receipts.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
      for (const segment of ['prime', 'offline', 'restart']) {
        const startup = rows.find(r => r.startup?.segment === segment)?.startup;
        if (startup?.javascriptSha256 !== sample.bundleHash) throw Error(`loaded hash mismatch: ${name}/${segment}`);
      }
    }
  }
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const bytes = fs.readFileSync(path.join(source, entry.name));
    const compressed = bytes.length > 131072 && /\.(json|jsonl|log)$/.test(entry.name);
    const target = path.join(destination, entry.name + (compressed ? '.gz' : ''));
    fs.writeFileSync(target, compressed ? gzipSync(bytes) : bytes);
    retained.push({ source: path.join(source, entry.name), retained: path.relative(report, target), bytes: bytes.length, sha256: hash(bytes), storedSha256: hash(fs.readFileSync(target)) });
  }
}
fs.writeFileSync(path.join(report, 'retention.json'), JSON.stringify(retained, null, 2));
console.log(`Retained and verified ${retained.length} files; app products independently inventoried before cleanup.`);
