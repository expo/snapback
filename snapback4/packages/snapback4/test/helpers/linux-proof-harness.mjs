import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Execute the production shell body with local stand-ins for guest tools. The
// roundtrip entrypoint itself runs under Node; its deliberately failing variant
// must propagate through sh -e and the real qualifier without a receipt.
export function runProofShell(exec, script, { root, cwd, inputs, node, scenario }) {
  assert.ok(script.includes('test -z "${SNAPBACK4_BIN+x}"'), "proof must guard the binary override");
  assert.ok(script.includes("node -v"), "proof must check the guest Node pin");
  const bin = join(cwd, "tools"), events = join(cwd, "events.jsonl"); mkdirSync(bin);
  for (const name of ["node", "npm", "cp"]) {
    const path = join(bin, name);
    writeFileSync(path, `#!${process.execPath}
import { appendFileSync, copyFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
const name = ${JSON.stringify(name)}, inputs = ${JSON.stringify(inputs)}, args = process.argv.slice(2);
const record = value => appendFileSync(${JSON.stringify(events)}, JSON.stringify(value) + '\\n');
if (name === 'cp') copyFileSync(join(inputs, basename(args[0])), join(process.cwd(), basename(args[0])));
if (name === 'npm') {
  const integrity = path => 'sha512-' + createHash('sha512').update(readFileSync(path)).digest('base64');
  record({ event: 'install', args, clientIntegrity: integrity(join(inputs, 'client.tgz')), platformIntegrity: integrity(join(inputs, 'platform.tgz')) });
}
if (name === 'node' && args[0] === '-v') {
  record({ event: 'node-version' }); console.log('v${scenario.wrongNode ? "0.0.0" : node}');
} else if (name === 'node') {
  if (args[0] === "/proof/starters.mjs") args[0] = join(inputs, "starters.mjs");
  execFileSync(${JSON.stringify(process.execPath)}, args, { stdio: 'inherit' });
}
`);
    chmodSync(path, 0o755);
  }
  const env = { PATH: bin, PROOF_EVENTS: events, PROOF_FAIL: scenario.proofFail ? "1" : "0", STARTERS_FAIL: scenario.startersFail ? "1" : "0" };
  if (scenario.overridePresent) env.SNAPBACK4_BIN = "/forbidden/host-binary";
  exec("/bin/sh", ["-ec", script], { cwd, env, stdio: "pipe" });
  const observed = readFileSync(events, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(observed.map(e => e.event), ["node-version", "install", "roundtrip", "starters"], "the proof entrypoint must execute after the Node check and installation");
  assert.deepEqual(observed[1].args, ["install", "--ignore-scripts", "--no-audit", "--no-fund", "/proof/client.tgz", "/proof/platform.tgz"], "npm must install both qualified tarballs");
  assert.equal(observed[2].override, false);
  const path = join(root, "executed-proofs.jsonl");
  // Keep actual execution evidence outside cleaned-up guest scratch.
  writeFileSync(path, (scenario.previousProofs ?? "") + JSON.stringify(observed) + "\n");
  scenario.previousProofs = readFileSync(path, "utf8");
}

export const proofEntrypoint = `
import { appendFileSync } from 'node:fs';
appendFileSync(process.env.PROOF_EVENTS, JSON.stringify({ event: 'roundtrip', override: Object.hasOwn(process.env, 'SNAPBACK4_BIN') }) + '\\n');
if (process.env.PROOF_FAIL === '1') throw Error('deliberately failing consumer entrypoint');
`;
