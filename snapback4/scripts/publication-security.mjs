import { guideReference } from "./publication-guide.mjs";
// @ref LLP 3000.036.004#4-counterexamples-and-generated-tests — qualify the installed policy surface and its finite campaigns.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runToolchainCommand } from "./publication-starters.mjs";

const sha256 = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const explorationWorkBound = "check concrete exploration work budget exhausted; remaining paths unproved; run snapback4 test for the full campaign";
const explorationBounds = new Set([
  explorationWorkBound,
  "check concrete exploration time budget exhausted; remaining paths unproved; run snapback4 test for the full campaign",
]);

function normalizeExplorationBound(report) {
  const coverage = report.campaign_coverage;
  assert.ok(Array.isArray(coverage), "audit report carries campaign coverage");
  const recognized = coverage.filter(item => explorationBounds.has(item));
  assert.equal(recognized.length, 1, "audit report carries one recognized exploration bound");
  return { ...report, campaign_coverage: coverage.map(item => explorationBounds.has(item) ? explorationWorkBound : item) };
}

/** Execute only the supplied packed client/CLI; never build or repack source.
 * Evidence contains counters and verdicts, never credentials or HTTP bodies. */
export async function proveSecurity(clientTarball, platformTarball, directory) {
  const client = resolve(clientTarball), platform = resolve(platformTarball);
  const artifacts = { clientSha256: sha256(client), platformSha256: sha256(platform) };
  const parent = resolve(directory); mkdirSync(parent, { recursive: true });
  const cwd = mkdtempSync(join(parent, "security-policy-"));
  const env = { ...process.env, CI: "1", npm_config_audit: "false", npm_config_fund: "false" };
  delete env.SNAPBACK4_BIN; delete env.PORT_LO; delete env.PORT_HI;
  writeFileSync(join(cwd, "package.json"), '{"private":true,"type":"module"}');
  await runToolchainCommand("npm", ["install", "--ignore-scripts", "--omit=optional", "--no-audit", "--no-fund", client, platform], {
    cwd, env, timeout: 300_000,
  });
  const cli = join(cwd, "node_modules/snapback4/bin/snapback4.js");
  const native = join(cwd, "node_modules", `snapback4-${process.platform}-${process.arch}`, "snapback4");
  const binarySha256 = sha256(native), commands = [];
  function command(args, project = cwd, expected = 0) {
    if (process.env.SNAPBACK4_SECURITY_PROGRESS) process.stdout.write(`security proof: ${project.slice(cwd.length) || "."} ${args[0]}\n`);
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: project, env, encoding: "utf8", timeout: 120_000, maxBuffer: 32 * 1024 * 1024,
    });
    commands.push({ args, project: project.slice(cwd.length) || ".", exitCode: result.status, expectedExitCode: expected });
    // Child output can contain replayed rows. Keep failure diagnostics to stable
    // codes and process state rather than serializing potentially private rows.
    const codes = [...new Set(((result.stdout ?? "") + (result.stderr ?? "")).match(/\b[EN]_[A-Z][A-Z0-9_]+\b/g) ?? [])];
    assert.equal(result.error, undefined, `${args.join(" ")}: ${result.error?.code ?? "process error"}`);
    assert.equal(result.status, expected, `${args.join(" ")}: expected exit ${expected}, got ${result.status}; codes: ${codes.join(", ")}`);
    return result.stdout;
  }
  function schemaProject(name, source) {
    const project = join(cwd, name); mkdirSync(join(project, "snapback"), { recursive: true });
    writeFileSync(join(project, "snapback/schema.q"), source); return project;
  }
  function checked(project) {
    const result = JSON.parse(command(["check", "--json"], project));
    assert.equal(result.ok, true); assert.ok(result.security?.invariants.length > 0);
    assert.ok(result.security.invariants.every(verdict => ["proved", "unproved"].includes(verdict.status)));
    return result.security;
  }
  function campaign(project, requireHttp = false) {
    // This consumer inspects full campaign counters/traces, not the brief verdict.
    const output = command(["test", "--fixture-only", "--explain"], project);
    const counts = /security tests: (\d+) attempted, (\d+) refused, (\d+) reachable violations; (\d+) seed\/synthetic observations \(non-failing\); finite campaign, not proof/.exec(output);
    assert.ok(counts, "default test executes the generated finite security campaign");
    assert.equal(Number(counts[3]), 0);
    assert.doesNotMatch(output, /security boundary failure:|security HTTP failure:|security violation:/);
    const http = /security unauthenticated serve HTTP: (\d+) attempts refused/.exec(output);
    const artifactBoundary = "security not covered: unauthenticated serve HTTP for native/action/effect applications needs its complete deployed artifacts";
    assert.ok(Number(counts[1]) + Number(http?.[1] ?? 0) > 0, `security campaign attempts policy or isolated HTTP challenges in ${project}`);
    if (requireHttp) assert.ok(http && Number(http[1]) > 0, "the isolated production HTTP campaign runs");
    else assert.ok((http && Number(http[1]) > 0) || output.includes(artifactBoundary), "HTTP coverage is executed or explicitly bounded by deployed artifacts");
    return { attempted: Number(counts[1]), refused: Number(counts[2]), violations: Number(counts[3]), seedSyntheticObservations: Number(counts[4]), unauthenticatedHttpRefused: Number(http?.[1] ?? 0),
      ...(http ? {} : { unauthenticatedHttpNotCovered: "complete deployed native/action/effect artifacts required" }),
      revocationHttpRefused: Number(/security live-session revocation HTTP: (\d+) attempts refused/.exec(output)?.[1] ?? 0) };
  }

  const guide = guideReference(cli,"security",{cwd,env});
  const blocks = [...guide.matchAll(/```quarry\n([\s\S]*?)\n```/g)].map(match => match[1]);
  assert.ok(blocks.length > 0, "installed security guide contains executable Quarry");
  const guideCases = [];
  for (const [index, source] of blocks.entries()) {
    const project = schemaProject(`card-${index}`, source);
    // Additional complete recipes have their own installed mutation witnesses
    // (sec10-packed). Compile each exact block here as well; the disclosure
    // counterexample below belongs specifically to the privateNotes example.
    if (!source.includes("table privateNotes:")) {
      const result = JSON.parse(command(["check", "--json"], project));
      assert.equal(result.ok, true);
      guideCases.push({ block: index, compile: "passed", invariants: result.security?.invariants.length ?? 0 });
      continue;
    }
    const security = checked(project);
    assert.ok(security.invariants.every(verdict => verdict.direct_rule === "proved"));
    assert.match(readFileSync(join(project, "snapback/generated/security-invariants.q.draft"), "utf8"), /DRAFT: NOT ACCEPTED/);
    const audited = JSON.parse(command(["audit", "--json"], project));
    assert.equal(audited.format, 1); assert.ok(audited.exposures.some(exposure => exposure.table === "privateNotes"));
    assert.ok(audited.exposures.some(exposure => exposure.table === "privateNotes" && exposure.column_audiences?.body), "installed audit exposes the body column audience");
    const checkAudit = JSON.parse(command(["check", "--audit", "--json"], project));
    assert.equal(checkAudit.format, 1);
    // Wall-clock contention can reach the time bound just before the same
    // finite campaign reaches its work bound. Both diagnostics describe the
    // same bounded coverage; every other field remains exact.
    assert.deepEqual(normalizeExplorationBound(checkAudit), normalizeExplorationBound(audited), "check --audit is the structured audit alias");
    const finite = campaign(project, true);
    const broad = source.replace("read <- .patient = viewer", "read <- allow");
    assert.notEqual(broad, source, "the installed card's private read is widened for the counterexample");
    writeFileSync(join(project, "snapback/schema.q"), broad);
    const refuted = JSON.parse(command(["check", "--json"], project, 1));
    assert.equal(refuted.ok, false);
    const readVerdicts = refuted.security.invariants.filter(verdict => verdict.invariant.target === "read");
    assert.equal(readVerdicts.length, 2, "the installed card exercises row and column read intent");
    assert.ok(readVerdicts.every(verdict => verdict.status === "refuted" && ["authored-fixture-trace", "generated-fixture-trace"].includes(verdict.counterexample?.reachability)), "actual authored row/column disclosure retains explicit fixture initialization provenance");
    const auditRefuted = JSON.parse(command(["audit", "--json"], project, 1));
    assert.ok(auditRefuted.invariants.some(verdict => verdict.status === "refuted"));
    command(["test", "--fixture-only"], project, 1);
    guideCases.push({ block: index, invariants: security.invariants.length, audit: "passed", finite, broadRead: "refuted", expectedFailureExits: [1, 1, 1] });
  }

  // The installed start/README/security loop must lead to independent answers,
  // including excluded roles. No generated declaration may silently copy rules.
  const start = command(["guide", "start", "--full", "--repeat"]);
  const workflow = guideReference(cli,"workflow",{cwd,env});
  const readme = readFileSync(join(cwd, "node_modules/snapback4/README.md"), "utf8");
  // TOK1 routes README -> bounded start -> feature references on demand.
  // Preserve the policy checklist in the cards that own it, rather than
  // requiring the introductory card tour in the short README.
  assert.match(readme, /npx snapback4 guide start/);
  assert.match(readme, /guide api react\|client\|auth\|proof\|generated/);
  assert.match(start, /guide workflow/);
  assert.match(start, /independent spec intent/);
  assert.match(workflow, /invariant requests\.read only/);
  assert.match(workflow, /invariant requests\.price read only/);
  assert.match(workflow, /denied\(await staff\.mutate\(api\.approve/);
  assert.match(workflow, /denied\(await guest\.mutate\(api\.fit/);
  assert.match(workflow, /!\('price' in r\)/);
  assert.match(workflow, /other\.query\(api\.board/);
  assert.ok(Buffer.byteLength(start) <= 8001, "the complete installed start remains within the 8000-byte card budget plus newline");
  for (const text of [guide]) {
    assert.match(text, /spec/i); assert.match(text, /role/); assert.match(text, /column/);
    assert.match(text, /check/); assert.match(text, /test/); assert.match(text, /audit/);
  }
  const questions = schemaProject("intent-questions", `table roles:
  principal: principal
  role: enum('coach','parent','clinician')
  unique principal
  read <- .principal = viewer
  insert <- viewer = 'service:operator'
  online only
table notes:
  athlete: principal
  status: enum('draft','shared')
  diagnosis: text <=80
  read <- exists roles[viewer, role = 'coach'] and .status = 'shared'
  online only
invariant notes.read only exists roles[viewer, role = 'coach']
`);
  const questionReport = checked(questions);
  const restating = questionReport.notes.find(note => note.code === "N_INVARIANT_RESTATES_RULE");
  assert.ok(restating?.message.includes("roles.role = 'coach'") && restating.message.includes(".status"), "installed check names the admitted role and state condition");
  const questionnaire = readFileSync(join(questions, "snapback/generated/security-invariants.q.draft"), "utf8");
  for (const role of ["coach", "parent", "clinician"]) {
    for (const target of ["notes.read /", "notes.diagnosis ("]) {
      assert.ok(questionnaire.split("\n").some(line => line.includes(target) && line.includes(`'${role}'`)), `${target} asks about ${role}, including excluded roles`);
    }
  }
  assert.ok(!questionnaire.includes("invariant notes."), "questionnaire proposes no policy copies");
  assert.ok(questionnaire.split("\n").every(line => !line || line.startsWith("--")));
  command(["test", "--fixture-only"], questions);
  command(["audit", "--json"], questions);

  const editsOnly = schemaProject("column-update-intent", `use identity password
 table tickets:
  price: int
  read <- allow
  insert <- allow
  update <- viewer = 'service:operator'
  online only
invariant tickets.price update only viewer = 'service:operator'
mutation create():
  return insert tickets {price: 1}
table pulses:
  principal: principal
  unique principal
  read <- allow
  insert <- .principal = viewer
  update <- .principal = viewer
  ephemeral 4s
mutation ping():
  upsert pulses[viewer] {}
`.replace("\n table", "\ntable"));
  checked(editsOnly); campaign(editsOnly, true);
  command(["test"], editsOnly); // No personas, developer store or handwritten fixtures.

  // New SEC6 examples exercise packed constructors and both observation paths.
  const validation = join(cwd, "session-validation.mjs");
  writeFileSync(validation, `import assert from 'node:assert/strict';
import { createClient } from 'snapback4/client';
import { createLocalClient } from 'snapback4/local';
let effects=0;
const options={url:'https://unused.invalid',fetch:async()=>{effects++;throw Error('unexpected transport');},device:{open:async()=>{effects++;throw Error('unexpected device');}}};
for(const expiresAt of [undefined,NaN,Infinity,0]){
 const session={principal:'user:test',kind:'user',token:'private',expiresAt};
 assert.throws(()=>createClient({...options,session}),/E_SESSION.*expiresAt/);
 await assert.rejects(createLocalClient({...options,session}),/E_SESSION.*expiresAt/);
}
assert.equal(effects,0);
const c=createClient({url:options.url,session:{principal:'user:test',kind:'user',token:'valid',expiresAt:Date.now()+86400000}});
assert.equal(c.session().token,'valid');await c.close();
`);
  await runToolchainCommand(process.execPath, [validation], { cwd, env, timeout: 30_000 });
  const creation = schemaProject("sec6-multi-write", `table docs:
  owner: principal
  body: text <=40 ?
  read <- allow
  insert <- allow
  update <- viewer = 'service:editor'
  online only
mutation add(owner: principal, body: text <=40 ?):
  d = insert docs {owner,body}
  insert docs {owner,body}
  return d
mutation edit(doc: docs, body: text <=40 ?):
  require viewer = 'service:editor' else NO
  update docs[doc] {body}
invariant docs.body write only .owner = viewer
`);
  const creationCheck = JSON.parse(command(["check", "--json"], creation, 1));
  assert.ok(creationCheck.security.notes.some(n => n.code === "N_INSERT_WRITE_INTENT"));
  const creationOutput = command(["test", "--fixture-only", "--explain"], creation, 1);
  assert.match(creationOutput, /security violation:/);
  assert.match(creationOutput, /"operation":"add"/);
  const privacy = schemaProject("sec6-write-result", `table docs:
  owner: principal
  title: text <=40
  secret: text <=40
  read <- allow
  insert <- allow
  update <- allow
  online only
shape publicDoc = {id,title}
query list():
  return docs first 10 by .id publicDoc
mutation create():
  return insert docs {owner:viewer,title:'public',secret:'private'}
mutation edit(doc: docs):
  update docs[doc] {title:'changed'}
invariant docs.secret read only .owner = viewer
`);
  const privacyOutput = command(["test", "--fixture-only", "--explain"], privacy, 1);
  assert.match(privacyOutput, /"effect":"mutation result"/);
  const privacyCheck = JSON.parse(command(["check", "--json"], privacy, 1));
  assert.ok(privacyCheck.security.notes.some(n => n.code === "N_COLUMN_RESULT_EXPOSURE"));
  const sec6 = { suppliedSession: "passed before side effects", multiWrite: "refuted by authored add", mutationResult: "refuted by authored edit" };

  const sessions = [];
  for (const method of ["guests", "password"]) {
    const project = schemaProject(`revocation-${method}`, `use identity ${method}
table notes:
  owner: principal
  read <- .owner = viewer
  insert <- .owner = viewer
  online only
invariant notes.read only .owner = viewer
query notes():
  return notes first 10 by .id
mutation add():
  return insert notes { owner: viewer }
`);
    checked(project);
    const finite = campaign(project, true);
    assert.equal(finite.revocationHttpRefused, 14, "actual refresh and logout-all retire both credentials at all seven doors");
    sessions.push({ method, status: "passed", ...finite, disconnectedDevice: "not covered" });
  }

  const starters = [];
  for (const starter of [
    { id: "todo-backend", flags: [], intent: "invariant todos.toggle only .ownerId = viewer" },
    { id: "todo-online", flags: ["--online"], intent: "invariant todos.toggle only .ownerId = viewer" },
    { id: "social", flags: ["--template", "social"] },
    { id: "todo-web", flags: ["--web"] },
    { id: "chat-web", flags: ["--template", "chat", "--web"], intent: "invariant messages.send only .authorId = viewer" },
    { id: "chat-expo", flags: ["--template", "chat", "--expo"], intent: "invariant messages.send only .authorId = viewer" },
  ]) {
    const project = join(cwd, starter.id); command(["init", "--no-install", project, ...starter.flags]);
    const source = readFileSync(join(project, "snapback/schema.q"), "utf8");
    if (starter.intent) assert.ok(source.includes(starter.intent), `${starter.id} ships its independent intent`);
    const security = checked(project), finite = campaign(project);
    starters.push({ id: starter.id, status: "passed", invariants: security.invariants.length, ...finite });
  }
  const production = schemaProject("production-recipe", "");
  copyFileSync(join(cwd, "node_modules/snapback4/dist/recipes/production/web/schema.q"), join(production, "snapback/schema.q"));
  const productionSecurity = checked(production);
  starters.push({ id: "production-recipe", status: "passed", source: "installed dist/recipes/production/web/schema.q", invariants: productionSecurity.invariants.length, ...campaign(production) });
  assert.equal(starters.length, 7);

  assert.equal(sha256(native), binarySha256, "installed CLI binary is unchanged");
  assert.equal(sha256(client), artifacts.clientSha256, "supplied client tarball is unchanged");
  assert.equal(sha256(platform), artifacts.platformSha256, "supplied platform tarball is unchanged");
  const result = { status: "passed", guide: "verbatim installed security card", artifacts: { ...artifacts, binarySha256 }, guideCases, sessions, starters, sec6,
    scope: "finite campaigns and declared policy checks; no zero-hole or disconnected-device revocation claim", commands };
  writeFileSync(join(cwd, "security-evidence.json"), JSON.stringify(result, null, 2) + "\n");
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [client, platform, directory] = process.argv.slice(2);
  if (!client || !platform || !directory) throw Error("usage: publication-security.mjs client.tgz platform.tgz output-directory");
  console.log(JSON.stringify(await proveSecurity(client, platform, directory)));
}
