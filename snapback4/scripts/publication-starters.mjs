// @ref LLP 3000.011.003.000#10 — packed starters must pass their real web toolchains
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { Worker } from "node:worker_threads";
import { loadavg } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";

// The live keeper alone signals its own group. Closing its private pipe also
// cleans up if this runner dies; no cached PID ever authorizes a signal.
export async function runToolchainCommand(command, args, { cwd, env, timeout }) {
  const owner = fileURLToPath(new URL("./test-command-owner.mjs", import.meta.url));
  const keeper = spawn(process.execPath, [owner, "100", command, ...args], { cwd, env, detached: true, stdio: ["pipe", "inherit", "inherit", "ipc"] });
  let released = false, completed = false, failure, status;
  const release = mode => { if (!released) { released = true; keeper.stdin.end(mode); } };
  const fail = error => { failure ??= error; release("TERM"); };
  const timer = setTimeout(() => fail(Error(`${command}: toolchain command timed out`)), timeout);
  keeper.stdin.on("error", error => { failure ??= error; });
  keeper.on("message", message => {
    if (message.error) fail(Error(message.error));
    if (message.exited) { completed = true; status = message.status; release("KILL"); }
  });
  await new Promise(done => {
    keeper.once("error", error => { failure ??= error; });
    keeper.once("close", done);
  });
  clearTimeout(timer);
  if (!released || !completed) failure ??= Error(`${command}: command owner exited without a result`);
  // This read-only group-existence probe needs no /proc mount in the clean
  // userspace. Refuse on lingering members or ambiguous/permission errors.
  // Two empty observations also protect against a transient inspection result.
  const deadline = performance.now() + 5_000;
  let empty = 0;
  if (keeper.pid) while (empty < 2) {
    try { process.kill(-keeper.pid, 0); empty = 0; }
    catch (error) { if (error.code === "ESRCH") empty++; else { failure ??= error; break; } }
    if (empty === 2) break;
    if (performance.now() >= deadline) { failure ??= Error(`${command}: toolchain process group did not drain`); break; }
    await sleep(50);
  }
  if (failure) throw failure;
  if (status !== 0) throw Error(`${command}: toolchain command exited ${status}`);
}

// Only explicitly recorded, still-unpatched advisories may warn instead of fail.
// Check every meta-vulnerability too: a fixed ancestor must never be waived.
export function evaluateStarterAudit(report, starter, allowlist, latest, today = new Date().toISOString().slice(0, 10)) {
  assert.equal(report.auditReportVersion, 2, "npm audit must return a version-2 report");
  assert.ok(!report.error && report.vulnerabilities && report.metadata?.vulnerabilities, "npm audit failed to return findings");
  const warnings = new Set();
  const findings = Object.values(report.vulnerabilities);
  for (const finding of findings) {
    assert.ok(Array.isArray(finding.via) && finding.via.length, `${finding.name}: missing advisory provenance`);
    if (finding.fixAvailable !== false) {
      // npm can flag a meta-vulnerability as fixable even when its entire
      // published range is affected and audit fix offers no remediation.
      // Admit only this recorded, exact chain; never a concrete fix candidate.
      const exception = allowlist.filter(entry => entry.starters.includes(starter))
        .flatMap(entry => entry.metadataExceptions ?? []).find(entry => entry.package === finding.name);
      assert.ok(finding.fixAvailable === true && finding.range === "*" && exception?.reason
        && JSON.stringify(finding.via) === JSON.stringify(exception.via)
        && finding.via.every(name => typeof name === "string" && report.vulnerabilities[name]?.fixAvailable === false),
        `${finding.name}: a fix is available; update the starter toolchain`);
      assert.equal(latest[exception.package], exception.reviewedVersion,
        `${exception.package}: a new release is available; recheck the metadata exception`);
      warnings.add(`${exception.package}: recorded npm metadata anomaly (all versions affected, no remediation); recheck with its underlying advisory`);
    }
    const visit = (item, seen = new Set()) => {
      if (typeof item === "string") {
        assert.ok(!seen.has(item) && report.vulnerabilities[item], `${item}: invalid advisory chain`);
        for (const via of report.vulnerabilities[item].via) visit(via, new Set([...seen, item]));
        return;
      }
      const advisory = item.url?.match(/^https:\/\/github\.com\/advisories\/(GHSA-[a-z0-9-]+)$/)?.[1];
      const entry = allowlist.find(entry => entry.advisory === advisory && entry.package === item.name && entry.starters.includes(starter));
      assert.ok(entry, `${item.name}: unallowlisted advisory ${advisory ?? item.url}`);
      assert.match(entry.recheck, /^\d{4}-\d{2}-\d{2}$/, "allowlist recheck must be an ISO date");
      assert.ok(today < entry.recheck, `${advisory}: recheck date ${entry.recheck} reached`);
      assert.equal(latest[entry.package], entry.reviewedVersion, `${advisory}: a new ${entry.package} release is available; recheck the exception`);
      assert.ok(entry.reason && entry.pulledBy, `${advisory}: missing exception rationale`);
      warnings.add(`${advisory} (${entry.package}): no fix available; ${entry.pulledBy}; recheck by ${entry.recheck}`);
    };
    for (const via of finding.via) visit(via);
  }
  assert.ok(findings.length || report.metadata.vulnerabilities.total === 0, "npm audit omitted vulnerability details");
  return [...warnings];
}

async function auditStarter(run, cwd, starter) {
  const allowlist = JSON.parse(readFileSync(new URL("./starter-audit-allowlist.json", import.meta.url), "utf8"));
  const output = join(cwd, "starter-audit.json");
  // The ordinary toolchain owner retains custody of npm and its descendants.
  // npm audit's exit 1 means findings; all other command failures stay failures.
  await run(process.execPath, ["--input-type=commonjs", "-e", `
    const {spawnSync}=require('node:child_process'),{writeFileSync}=require('node:fs');
    const invoke=args=>{const r=spawnSync('npm',args,{encoding:'utf8',timeout:180000,maxBuffer:16777216});if(r.error||r.signal||r.status===null||r.status>1)throw Error(r.error||r.stderr||'npm failed');return r;};
    const audit=invoke(['audit','--json','--audit-level=low']);
    const report=JSON.parse(audit.stdout),latest={};
    for(const name of ${JSON.stringify([...new Set(allowlist.filter(entry => entry.starters.includes(starter)).flatMap(entry => [entry.package, ...(entry.metadataExceptions ?? []).map(meta => meta.package)]))])}) {
      const result=invoke(['view',name,'version','--json']);if(result.status!==0)throw Error(result.stderr);latest[name]=JSON.parse(result.stdout);
    }
    writeFileSync(${JSON.stringify(output)},JSON.stringify({report,latest}));
  `], cwd);
  const { report, latest } = JSON.parse(readFileSync(output, "utf8"));
  const warnings = evaluateStarterAudit(report, starter, allowlist, latest);
  for (const warning of warnings) console.warn(`WARNING starter ${starter}: ${warning}`);
  return { status: warnings.length ? "passed-with-warnings" : "passed", warnings };
}

export function guideTypeScriptExport(markdown, heading, exportName) {
  const headingAt = markdown.indexOf(heading);
  if (headingAt < 0) throw Error(`packed guide is missing ${heading}`);
  const afterHeading = markdown.slice(headingAt + heading.length);
  const nextHeading = afterHeading.search(/^### /m);
  const section = nextHeading < 0 ? afterHeading : afterHeading.slice(0, nextHeading);
  const blocks = [...section.matchAll(/^```ts\s*\n([\s\S]*?)^```\s*$/gm)].map(match => match[1].trim());
  const declaration = new RegExp(`export\\s+(?:async\\s+)?function\\s+${exportName}\\s*\\(`);
  const matches = blocks.filter(block => declaration.test(block));
  if (matches.length !== 1) throw Error(`packed guide ${heading} must contain exactly one TypeScript fence exporting ${exportName}; found ${matches.length}`);
  return matches[0];
}

// Every supported frontend/template pair; schema-only init has no frontend proof.
export const starterCases = [
  { id: "web", kind: "web", flags: ["--web"] },
  { id: "web-online", kind: "web", flags: ["--web", "--online"] },
  { id: "expo", kind: "expo", flags: ["--expo"] },
  { id: "web-chat", kind: "web", template: "chat", flags: ["--web", "--template", "chat"] },
  { id: "expo-chat", kind: "expo", template: "chat", flags: ["--expo", "--template", "chat"] },
  { id: "expo-social", kind: "expo", template: "social", flags: ["--template", "social"] },
];
async function boundedStop(work, label) {
  let timer;
  try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label + " timed out")), 10_000); })]); }
  finally { clearTimeout(timer); }
}
export async function proveFrontendTwice(run, cwd, starter) {
  const results = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const occupied = createServer();
    const low = await new Promise((resolve, reject) => { occupied.once("error", reject); occupied.listen(0, "127.0.0.1", () => resolve(occupied.address().port)); });
    const high = Math.min(65535, low + 20);
    const workers = Array.from({ length: 2 }, () => new Worker(`setInterval(() => { const until = performance.now() + 25; while (performance.now() < until) {} }, 50);`, { eval: true }));
    const started = Date.now(), load = loadavg();
    const audit = join(cwd, `listener-audit-${attempt}.json`);
    const trace = join(cwd, `listener-audit-${attempt}.trace`);
    const auditEnabled = process.platform === "linux";
    const tracerVersion = auditEnabled ? (await import("./proof-listener-audit.mjs")).requireListenerTracer() : undefined;
    const proofLogs = join(cwd, `proof-logs-${attempt}`);
    try {
      rmSync(join(cwd, "dist"), { recursive: true, force: true });
      await run(auditEnabled ? "strace" : process.execPath, [...(auditEnabled ? ["-f", "-q", "-z", "-yy", "-e", "trace=listen", "-e", "signal=none", "-o", trace, process.execPath] : []), "scripts/frontend-proof.mjs"], cwd, { PORT_LO: String(low), PORT_HI: String(high), SNAPBACK4_PROOF_LOGS: proofLogs });
      const listenerAudit = auditEnabled ? (await import("./proof-listener-audit.mjs")).auditListenerTrace(readFileSync(trace, "utf8"), low, high) : { status: "not-run", reason: "listener audit belongs to Linux qualification" };
      if (auditEnabled) { assert.equal(listenerAudit.status, "passed"); assert.ok(listenerAudit.samples > 0); listenerAudit.tracerVersion = tracerVersion; }
      assert.ok(existsSync(proofLogs));
      writeFileSync(audit, JSON.stringify(listenerAudit));
      results.push({ starter: starter.id, kind: starter.kind, attempt, status: "passed", elapsedMs: Date.now() - started, range: [low, high], occupied: low, cpuLoadWorkers: workers.length, loadavg: load, listenerAudit, logs: proofLogs });
    } finally {
      const stopped = await Promise.allSettled([...workers.map(worker => boundedStop(worker.terminate(), "CPU worker stop")), boundedStop(new Promise(resolve => occupied.close(resolve)), "occupied listener close")]);
      const failures = stopped.filter(result => result.status === "rejected").map(result => result.reason);
      if (failures.length) throw new AggregateError(failures, "loaded-host proof cleanup failed");
    }
  }
  return results;
}

// A fixture-owned component makes the custom Home prove an actual rendered write.
export function installCustomWriteScenario(cwd,kind,template) {
  assert.ok(["web","expo"].includes(kind));
  const screen=join(cwd,kind === "web" ? "src/App.tsx" : "App.tsx");
  const proofPath=join(cwd,"scripts/frontend-proof.mjs");
  const original=readFileSync(screen,"utf8"), proof=template ?? readFileSync(proofPath,"utf8");
  assert.equal(original.split("<FirstRead />").length-1,1,"custom qualification needs one generated Home read slot");
  assert.ok(original.includes("function Home()") && !original.includes("function ProofWrite()"),"custom qualification needs a fresh Home");
  const needle=/const within = [^\n;]+;/g;
  assert.equal([...proof.matchAll(needle)].length,1,"custom qualification needs the generated scope slot");
  const imports=`import {useState as proofState} from 'react';\nimport {useMutation as proofMutation,useQuery as proofQuery} from 'snapback4/react';\n`
    +(kind === "expo" ? `import {TextInput as ProofTextInput} from 'react-native';\n` : '');
  const body=kind === "web"
    ? `<section id="proof-rows"><form onSubmit={e=>{e.preventDefault();void writer.run({title:draft})}}><input aria-label="Task" value={draft} onChange={e=>setDraft(e.target.value)}/><button type="submit">Add</button></form><p>{"data" in rows?JSON.stringify(rows.data):""}</p></section>`
    : `<View nativeID="proof-rows"><ProofTextInput accessibilityLabel="Task" value={draft} onChangeText={setDraft}/><Button title="Add" onPress={()=>void writer.run({title:draft})}/><Text>{"data" in rows?JSON.stringify(rows.data):""}</Text></View>`;
  const component=`\nfunction ProofWrite(){const [draft,setDraft]=proofState("");const writer=proofMutation(api.add),rows=proofQuery(api.mine,{});return ${body};}\n`;
  const source=imports+original.replace("<FirstRead />","<FirstRead /><ProofWrite />")+component;
  // Replacing Home also replaces its starter-only filter/status controls.
  // Retain the custom Task write, SDK receipt and rendered-row assertions.
  const assertion=proof.replace(needle,'const within = page.locator("#proof-rows");')
    .replace('const filter = page.getByRole("combobox", { name: "Task status", exact: true });\n    await filter.selectOption("open");\n    await filter.selectOption("all");', '')
    .replace('await page.getByLabel("Write status", { exact: true }).waitFor();', '');
  writeFileSync(screen,source);writeFileSync(proofPath,assertion);
}

// Runs outside a checkout, using only packed release artifacts. Registry access
// is needed for Expo/Vite dependencies; npm prefers cached downloads when present.
export async function proveStarters(client, platform, expo, directory, browserProofs = true) {
  const env = { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1", EXPO_OFFLINE: "1", npm_config_audit: "false", npm_config_fund: "false" };
  delete env.SNAPBACK4_BIN;
  const deadline = performance.now() + 1_200_000;
  const run = (cmd, args, cwd, overrides = {}) => {
    const remaining = Math.ceil(deadline - performance.now());
    if (remaining <= 0) throw Error("starter qualification exceeded its twenty-minute guard");
    return runToolchainCommand(cmd, args, { cwd, env: { ...env, ...overrides }, timeout: Math.min(300_000, remaining) });
  };
  const artifacts = [client, platform, expo].map(path => resolve(path));
  const results = [];
  for (const starter of starterCases) {
    const { kind, template, id, flags } = starter;
    const cwd = join(directory, `starter-${id}`); mkdirSync(cwd);
    writeFileSync(join(cwd, "package.json"), '{"private":true}');
    // Install the CLI first so init and all later package scripts resolve the
    // packed binary. Pin native JS in init's manifest before dependency install.
    await run("npm", ["install", "--no-save", "--ignore-scripts", "--no-audit", "--no-fund", ...artifacts.slice(0, 2)], cwd);
    const cli = join(cwd, "node_modules/.bin/snapback4");
    await run(cli, ["init", "--no-install", ...flags], cwd);
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json")));
    pkg.dependencies.snapback4 = `file:${artifacts[0]}`;
    pkg.optionalDependencies = { [`snapback4-${process.platform}-${process.arch}`]: `file:${artifacts[1]}` };
    if (kind === "expo") pkg.dependencies["snapback4-expo"] = `file:${artifacts[2]}`;
    writeFileSync(join(cwd, "package.json"), JSON.stringify(pkg, null, 2));
    // Lifecycle scripts are enabled: esbuild and the other real tools need them.
    await run(process.execPath, ["scripts/install.mjs", "--prefer-offline", "--no-audit", "--no-fund"], cwd);
    // Runtime fixture proofs use the pinned Node 24 host. Clean userspaces
    // are build-only (Ubuntu intentionally carries Node 22, without TS workers).
    if (browserProofs) {
      if (!existsSync(join(cwd, "fixtures"))) mkdirSync(join(cwd, "fixtures"));
      // H9/R1: execute the shipped guide block verbatim, including on persona-only apps.
      const fixtureProof = join(cwd, "guide-fixtures-proof.mjs");
      writeFileSync(fixtureProof, `import assert from 'node:assert/strict';
  import {execFileSync} from 'node:child_process';
  import {readFileSync,writeFileSync,existsSync} from 'node:fs';
  import {createHash} from 'node:crypto';
  import {startDev,loadFixtures,cleanup} from 'snapback4/proof';
  import {pathToFileURL} from 'node:url';
  const guideTypeScriptExport=${guideTypeScriptExport.toString()};
  const cli=${JSON.stringify(cli)}, testPersistent=${JSON.stringify(id === "web")};
  const guide=execFileSync(cli,['guide','testing','--section','Loading fixture rows','--repeat'],{encoding:'utf8',timeout:10000});
  const fence=String.fromCharCode(96).repeat(3), snippet=guide.split(fence+'js')[1].split(fence)[0].trim();
  writeFileSync('guide-fixtures-snippet.mjs',snippet);
  const schema='snapback/schema.q', original=readFileSync(schema,'utf8');
  let durableHash;
  const hash=()=>createHash('sha256').update(readFileSync('.snapback4/store.sqlite')).digest('hex');
  if(testPersistent){
    const opening=execFileSync(cli,['guide','testing','--section','1','--repeat'],{encoding:'utf8',timeout:10000});
    writeFileSync('guide-host-opening.mjs',opening.split(fence+'js')[1].split(fence)[0].trim());
    await import(pathToFileURL(process.cwd()+'/guide-host-opening.mjs').href);
    const durable=await startDev({args:['--unsafe-dev-doors']});
    try {
      const rows=await loadFixtures('fixtures',{url:durable.url});
      assert.ok(rows.length,'prepopulate the existing developer store');
      rows[0].row.title='Persistent proof sentinel';
      const response=await fetch(durable.url+'/seed',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(rows)});
      assert.ok(response.ok);assert.equal((await response.json()).denied,undefined);
    } finally {await durable.stop();}
    assert.ok(existsSync('.snapback4/store.sqlite'));durableHash=hash();
  }
  try {
    for(const personasOnly of [false,true]) {
      writeFileSync(schema,personasOnly?original.replace(/^use identity.*$/m,''):original);
      const responses=[],originalFetch=globalThis.fetch;
      globalThis.fetch=async (...args)=>{const response=await originalFetch(...args);responses.push(await response.clone().json());return response;};
      try {await import(pathToFileURL(process.cwd()+'/guide-fixtures-snippet.mjs').href+'?only='+personasOnly);}
      finally {globalThis.fetch=originalFetch;}
      assert.equal(responses.at(-1).denied,undefined);
      assert.equal(responses.at(-1).reset,true);
    }
  } finally {writeFileSync(schema,original);}
  if(testPersistent){
    assert.equal(hash(),durableHash,'verbatim fixture guide preserved developer store');
    const reference=readFileSync('node_modules/snapback4/CLIENT-AND-OPERATIONS.md','utf8');
    const block=guideTypeScriptExport(reference,'### Application proofs in Node','developmentHosts');
    writeFileSync('guide-development-hosts.ts',block);
    const {developmentHosts}=await import(pathToFileURL(process.cwd()+'/guide-development-hosts.ts').href);
    await developmentHosts(process.cwd());
    assert.equal(hash(),durableHash,'verbatim client fixture recipe preserved developer store');
  }
  `);
      await run(process.execPath, [fixtureProof], cwd);
    }
    const build = async () => {
      await run(cli, ["check"], cwd);
      await run("npm", ["run", "typecheck"], cwd);
      if (kind === "expo") await run(join(cwd, "node_modules/.bin/expo"), ["export", "-p", "web", "--max-workers", "2"], cwd);
      await run("npm", ["run", kind === "expo" ? "build:web" : "build"], cwd);
      assert.ok(existsSync(join(cwd, "dist/index.html")), `${kind} produced a web page`);
    };
    await build();
    // DX9: dev tools ship to every builder, so audit includes dev dependencies.
    const audit = await auditStarter(run, cwd, id);
    // @ref LLP 3000.036.004#169-day-two-precision-and-destructive-evidence-questions — intended optional attachments never require a stock disposition.
    if (template === "social") await run(process.execPath, ["--input-type=commonjs", "-e", `
      const fs=require('node:fs'),assert=require('node:assert/strict'),cp=require('node:child_process');
      const cli=${JSON.stringify(cli)},schema='snapback/schema.q',original=fs.readFileSync(schema,'utf8');
      // The enclosing owned command already enforces the toolchain deadline
      // and drains descendants; a second 30s fuse is not a latency assertion.
      const check=()=>cp.spawnSync(cli,['check','--json'],{encoding:'utf8'});
      const stock=check();assert.equal(stock.status,0,stock.stdout+stock.stderr);
      assert.ok(!JSON.parse(stock.stdout).securityReviews.some(r=>r.code==='N_OPTIONAL_UPLOAD_CREATE'));
      assert.ok(!fs.existsSync('snapback/security-reviews.json'));
      try{fs.writeFileSync(schema,original+'\\n-- qualification changes the reviewed source\\n');const edited=check();assert.equal(edited.status,0,edited.stdout+edited.stderr);assert.ok(!JSON.parse(edited.stdout).securityReviews.some(r=>r.code==='N_OPTIONAL_UPLOAD_CREATE'));}
      finally{fs.writeFileSync(schema,original);}
    `], cwd);
    if (browserProofs && id === "web") {
      const card = join(cwd, "testing-card.md");
      await run(process.execPath, ["--input-type=commonjs", "-e", `require('node:fs').writeFileSync(${JSON.stringify(card)},require('node:child_process').execFileSync(${JSON.stringify(cli)},['guide','testing','--section','An acceptance script','--repeat'],{encoding:'utf8',timeout:30000}));`], cwd);
      const acceptance = readFileSync(card, "utf8").match(/```js\n([\s\S]*?)\n```/);
      assert.ok(acceptance, "packed testing card carries its browser recipe");
      writeFileSync(join(cwd, "guide-acceptance.mjs"), acceptance[1]);
      await run(process.execPath, ["guide-acceptance.mjs"], cwd);
    }
    if (template) {
      const screen = join(cwd, template === "social" ? "app/_layout.tsx" : kind === "web" ? "src/App.tsx" : "App.tsx");
      assert.match(readFileSync(screen, "utf8"), /useAppReady\(\)/, `${id} gates writers with useAppReady`);
    }
    // Read the recipe from the installed binary, then execute its fence unchanged.
    const surfaceCard = join(cwd, "surface-card.md");
    await run(process.execPath, ["--input-type=commonjs", "-e", `require('node:fs').writeFileSync(${JSON.stringify(surfaceCard)},require('node:child_process').execFileSync(${JSON.stringify(cli)},['guide','release-json','--section','opening','--repeat'],{encoding:'utf8',timeout:30000}));`], cwd);
    const recipe = readFileSync(surfaceCard, "utf8").match(/```js\n([\s\S]*?)\n```/);
    assert.ok(recipe, "packed release-json card carries its executable recipe");
    const surfaceProof = join(cwd, "surface-proof.mjs");
    writeFileSync(surfaceProof, recipe[1] + `
import assert from 'node:assert/strict';
assert.ok(host.url);const inspected=JSON.parse((await cli(['releases','deployment','latest','--json'])).stdout);for(const key of ['current','release','previous_active','latest','generation','revision','events','events_after','items','items_after','workers','selected'])assert.ok(key in inspected,key);assert.equal(inspected.selected.current,true);assert.equal(inspected.current,inspected.release);
`);
    await run(process.execPath, [surfaceProof], cwd);
    const frontendProofs = browserProofs ? await proveFrontendTwice(run, cwd, starter) : [];
    if (browserProofs && id === "web") {
      // Execute the standalone native driver against an installed, generated
      // password starter. The child resolves this packed consumer's toolchain.
      const password = join(cwd, "password-witness"); mkdirSync(password);
      try {
        await run(cli, ["init", "--no-install", "--web"], password);
        const schema = join(password, "snapback/schema.q");
        writeFileSync(schema, readFileSync(schema, "utf8").replace(/^use identity[^\n]*/m, "use identity password"));
        await run(cli, ["init", "--adapt", "--apply"], password);
        const passwordClient = readFileSync(join(password, "src/client.ts"), "utf8");
        assert.match(passwordClient, /registerWebWitness\(app, api\)/, "password adaptation keeps explicit witness registration");
        assert.match(passwordClient, /snapback\/generated\/api/);
        assert.doesNotMatch(passwordClient, /witnessPersona/, "password identity has no development persona");
        await run(cli, ["check"], password);
        await run(join(cwd, "node_modules/.bin/vite"), ["build"], password);
        await run(cli, ["witness", "web", "dist", "--email", "native-proof@example.test", "--password-env", "SNAPBACK4_DX6_TEST_PASSWORD", "--mutation", "add", "--args", '{"title":"Packed native proof"}', "--field", "Task", "--value", "Packed native proof", "--button", "Add"], password, { SNAPBACK4_DX6_TEST_PASSWORD: "Proof-password-928!" });
      } finally { rmSync(password, {recursive:true, force:true}); }
    }
    if (template || id === "web-online") {
      results.push({ starter: id, kind, template, audit, fixtureGuide: browserProofs ? "passed" : "not-run-build-only", status: "passed", typecheck: "passed", build: "passed", frontendProofs });
      continue;
    }
    // Exercise init-first adaptation with a different online-only schema: Home,
    // generated API, identity, README and the no-wasm journal must build together.
    writeFileSync(join(cwd, "snapback/schema.q"), `use identity guests\ntable notes:\n  owner: principal\n  title: text <=80\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\nquery mine():\n  return notes where .owner = viewer first 20 by .id\nmutation add(title: text <=80):\n  return insert notes { owner: viewer, title }\n`);
    const inheritedTodoProof=readFileSync(join(cwd,"scripts/frontend-proof.mjs"),"utf8");
    await run(cli, ["init", "--adapt", "--apply"], cwd);
    assert.equal(existsSync(join(cwd,"scripts/frontend-proof.mjs")),true,"adapted Home retains a runnable scaffold");
    assert.match(readFileSync(join(cwd,"scripts/frontend-proof.mjs"),"utf8"),/E_FRONTEND_SCENARIO/);
    const adaptedPackage=JSON.parse(readFileSync(join(cwd,"package.json"),"utf8"));
    assert.equal(adaptedPackage.scripts["frontend:proof"],"node scripts/frontend-proof.mjs");
    assert.equal(adaptedPackage.scripts["proof:web"],adaptedPackage.scripts["frontend:proof"]);
    await build();
    let negativeProof;
    if (browserProofs) {
      // Execute the retained scaffold unchanged: rendering is not a write proof.
      const guard = join(cwd, "negative-proof.mjs");
      const tracerVersion = process.platform === "linux" ? (await import("./proof-listener-audit.mjs")).requireListenerTracer() : undefined;
      const negativeTrace = join(cwd, "negative-listener-audit.trace");
      writeFileSync(guard, `import {spawnSync} from 'node:child_process'; import assert from 'node:assert/strict'; const r=spawnSync(${JSON.stringify(process.platform === 'linux' ? 'strace' : process.execPath)},${JSON.stringify([...(process.platform === 'linux' ? ['-f','-q','-z','-yy','-e','trace=listen','-e','signal=none','-o',negativeTrace,process.execPath] : []),'scripts/frontend-proof.mjs'])},{encoding:'utf8',timeout:240000,env:process.env}); process.stdout.write(r.stdout); process.stderr.write(r.stderr); assert.notEqual(r.status,0); assert.match(r.stderr,/E_FRONTEND_SCENARIO: frontend rendered/);`);
      const negativeAudit = join(cwd, "negative-listener-audit.json");
      await run(process.execPath, [guard], cwd, {PORT_LO:"30000",PORT_HI:"30020"});
      const listenerAudit = process.platform === "linux" ? (await import("./proof-listener-audit.mjs")).auditListenerTrace(readFileSync(negativeTrace,"utf8"),30000,30020) : {status:"not-run",reason:"listener audit belongs to Linux qualification"};
      if (process.platform === "linux") { assert.equal(listenerAudit.status,"passed"); assert.ok(listenerAudit.samples>0); listenerAudit.tracerVersion = tracerVersion; }
      writeFileSync(negativeAudit, JSON.stringify(listenerAudit));
      negativeProof = {status:"passed", expected:"E_FRONTEND_SCENARIO: frontend rendered", listenerAudit};
    }
    rmSync(join(cwd,"scripts/frontend-proof.mjs"),{force:true});
    installCustomWriteScenario(cwd,kind,inheritedTodoProof);
    const customPackage=JSON.parse(readFileSync(join(cwd,"package.json"),"utf8"));
    customPackage.scripts["frontend:proof"]="node scripts/frontend-proof.mjs";
    writeFileSync(join(cwd,"package.json"),JSON.stringify(customPackage,null,2)+"\n");
    await build();
    const adaptedProofs = browserProofs ? await proveFrontendTwice(run, cwd, starter) : [];
    results.push({ starter: id, kind, audit, fixtureGuide: browserProofs ? "passed" : "not-run-build-only", status: "passed", adapted: "passed", typecheck: "passed", build: "passed", frontendProofs, adaptedProofs, negativeProof, formSubmit: kind === "web" ? "passed" : "not-applicable" });
  }
  return results;
}
if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const [client, platform, expo, mode] = process.argv.slice(2);
  if (!client || !platform || !expo) throw Error("usage: publication-starters.mjs client.tgz platform.tgz expo.tgz");
  const results = await proveStarters(client, platform, expo, process.cwd(), mode !== "--build-only");
  console.log(JSON.stringify({ starters: results, dependencies: "npm registry (prefer-offline), Expo network checks disabled" }));
}
