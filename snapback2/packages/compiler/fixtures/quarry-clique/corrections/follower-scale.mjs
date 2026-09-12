#!/usr/bin/env node

// Copies only --handoff/snapback into three fresh isolated variants, audits
// every generated seed and certificate, then runs bulk setup outside the journey
// harness. The standalone setup budget is 120 seconds; the 3+20 post timings
// contain no setup work and no product/test ceiling is changed.
// node follower-scale.mjs --handoff /read-only/app --generation <64hex> \
//   --binary /snapback2 --compiler /dist/compiler.mjs \
//   --client /dist/client.mjs --work /new/empty/directory

import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { arch, hostname, platform, release } from "node:os";
import { boundedJsonRequest, capturedCommand, withOwnedOwner } from "./follower-scale-runtime.mjs";

const warmups = 3, measured = 20, setupBudgetMs = 120_000;
const setupBatchSize = 25, digestPollBudgetMs = 10_000;
const digestAdvanceMs = 60_000, digestAdvanceSteps = 4;

function fail(message, value) {
  throw new Error(value === undefined ? message : `${message}: ${JSON.stringify(value)}`);
}
function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function requirePath(name) {
  const value = argument(name);
  if (!value) fail(`missing ${name}`);
  return resolve(value);
}
function requireGeneration() {
  const value = argument("--generation");
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) fail("--generation must be 64 lowercase hex characters", value);
  return value;
}
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
async function fileIdentity(path) {
  const bytes = await readFile(path);
  return { path, bytes: bytes.byteLength, sha256: sha256(bytes) };
}
async function filesBelow(root, directory = root) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(root, path));
    else if (entry.isFile()) result.push(relative(root, path));
  }
  return result.sort();
}
async function treeIdentity(root) {
  const hash = createHash("sha256"), files = await filesBelow(root);
  for (const file of files) {
    const bytes = await readFile(join(root, file));
    hash.update(file).update("\0").update(sha256(bytes)).update("\0");
  }
  return { files: files.length, sha256: hash.digest("hex") };
}
function replaceOnce(source, anchor, replacement, label) {
  const first = source.indexOf(anchor);
  if (first < 0 || source.indexOf(anchor, first + anchor.length) >= 0) fail(`seed anchor ${label} was not unique`);
  return source.slice(0, first) + replacement + source.slice(first + anchor.length);
}

const profileAnchor = "      { id: \"profile-bob\", principal: \"dev:bob\", displayName: \"Bob\", handle: \"dev_bob\", bio: \"\", location: \"\" },\n";
const personasAnchor = "  personas: [\"alice\", \"bob\", \"charlie\", \"count-probe\", \"count-peer\"],";

function withFollowerPrincipals(seed, total) {
  const personas = [], profiles = [];
  for (let index = 0; index < total - 1; index += 1) {
    const suffix = String(index).padStart(4, "0");
    personas.push(`"scale-${suffix}"`);
    profiles.push(`      { id: "scale-profile-${suffix}", principal: "dev:scale-${suffix}", displayName: "Scale ${suffix}", handle: "scale_${suffix}", bio: "", location: "" },`);
  }
  let output = replaceOnce(seed, personasAnchor,
    `  personas: ["alice", "bob", "charlie", "count-probe", "count-peer", ${personas.join(", ")}],`, "personas");
  output = replaceOnce(output, profileAnchor, `${profileAnchor}${profiles.join("\n")}\n`, "profiles");
  return output;
}
function withDigestPrincipals(seed) {
  const profiles = [
    "      { id: \"0-digest-reader\", principal: \"dev:digest-reader\", displayName: \"Digest Reader\", handle: \"digest_reader\", bio: \"\", location: \"\" },",
    "      { id: \"digest-writer\", principal: \"dev:zzzz-activity\", displayName: \"Digest Writer\", handle: \"digest_writer\", bio: \"\", location: \"\" },",
  ];
  for (let index = 0; index < 499; index += 1) {
    const suffix = String(index).padStart(3, "0");
    profiles.push(`      { id: "digest-author-profile-${suffix}", principal: "dev:digest-author-${suffix}", displayName: "Digest Author ${suffix}", handle: "digest_${suffix}", bio: "", location: "" },`);
  }
  let output = replaceOnce(seed, personasAnchor,
    "  personas: [\"alice\", \"bob\", \"charlie\", \"count-probe\", \"count-peer\", \"digest-reader\", \"zzzz-activity\"],", "personas");
  output = replaceOnce(output, profileAnchor, `${profileAnchor}${profiles.join("\n")}\n`, "profiles");
  return output;
}
async function prepareVariant(handoff, root, seedTransform) {
  await mkdir(root, { recursive: false });
  await cp(join(handoff, "snapback"), join(root, "snapback"),
    { recursive: true, force: false, errorOnExist: true });
  await mkdir(join(root, ".snapback"), { recursive: false });
  const seedPath = join(root, "snapback", "seed.ts");
  await writeFile(seedPath, seedTransform(await readFile(seedPath, "utf8")));
  return { root, seed: await fileIdentity(seedPath), sourceTree: await treeIdentity(join(root, "snapback")),
    copyPolicy: "copied handoff/snapback only into a fresh root with an empty .snapback" };
}

export function certificateFacts(certificates, generation) {
  const generations = [...new Set(Object.values(certificates).map((item) => item.schema_hash))];
  if (generations.length !== 1 || generations[0] !== generation) fail("certificate generation differed", generations);
  const post = certificates["posts.createPost"], digest = certificates["admin.digestSweep"];
  if (!post || !digest) fail("required certificate absent");
  if (!Array.isArray(post.read_sites) || !Array.isArray(post.write_sites)) fail("post certificate sites were not arrays", post);
  const malformedReads = post.read_sites.filter((site) => typeof site.table !== "string"
    || !Number.isSafeInteger(site.take) || !Number.isSafeInteger(site.max_calls));
  const readBounds = post.read_sites.map((site) => `${site.table}:${site.take}:${site.max_calls}`).sort();
  const expectedReadBounds = ["appSettings:1:1", "dailyStats:1:1", "dailyStats:1:1",
    "postPeriodCounters:1:1", "postPeriodCounters:1:1", "profiles:1:1"].sort();
  const malformedWrites = post.write_sites.filter((site) => typeof site.table !== "string"
    || typeof site.kind !== "string" || !Number.isSafeInteger(site.max_rows));
  const writeBounds = post.write_sites.map((site) => `${site.table}:${site.kind}:${site.max_rows}`).sort();
  const expectedWriteBounds = ["posts:Insert:1", "timelineEvents:Insert:1", "trendingPosts:Insert:1",
    "postPeriodCounters:Update:1", "postPeriodCounters:Insert:1", "dailyStats:Update:1",
    "dailyStats:Insert:1", "posts:Insert:1", "timelineEvents:Insert:1", "trendingPosts:Insert:1",
    "postPeriodCounters:Update:1", "postPeriodCounters:Insert:1", "dailyStats:Update:1",
    "dailyStats:Insert:1", "_timers:Update:2"].sort();
  if (malformedReads.length > 0 || malformedWrites.length > 0
    || JSON.stringify(readBounds) !== JSON.stringify(expectedReadBounds)
    || JSON.stringify(writeBounds) !== JSON.stringify(expectedWriteBounds)) {
    fail("post certificate exact site bounds differed", { malformedReads, malformedWrites,
      readBounds, expectedReadBounds, writeBounds, expectedWriteBounds });
  }
  const followerReadSites = post.read_sites.filter((site) => site.table === "follows" || site.table === "digestFollows");
  const followerWriteSites = post.write_sites.filter((site) => site.table === "follows" || site.table === "digestFollows");
  if (followerReadSites.length > 0 || followerWriteSites.length > 0) {
    fail("post certificate accesses follower tables", { followerReadSites, followerWriteSites });
  }
  const digest500Sites = digest.read_sites.filter((site) => site.table === "digestFollows" && site.take === 500);
  if (digest500Sites.length !== 1 || digest500Sites[0].max_calls !== 1) {
    fail("digest certificate lacks its single-call 500-follow read", digest.read_sites);
  }
  return { post, digest500Site: digest500Sites[0], followerReadSites, followerWriteSites,
    readBounds, writeBounds };
}
async function auditVariants(variants, binary, compiler, generation, pids) {
  const syntax = [], checks = [], builds = [];
  for (const variant of variants) {
    syntax.push(await capturedCommand({ command: process.execPath,
      args: ["--experimental-strip-types", "--check", join(variant.root, "snapback", "seed.ts")],
      cwd: variant.root, env: process.env, label: `${variant.label}-seed-syntax`, pids }));
  }
  for (const variant of variants) {
    checks.push(await capturedCommand({ command: binary, args: ["check", "--json"], cwd: variant.root,
      env: { ...process.env, SNAPBACK2_NODE: process.execPath, SNAPBACK2_COMPILER: compiler }, label: `${variant.label}-check`, pids }));
  }
  for (const variant of variants) {
    const certificatesPath = join(variant.root, ".snapback", "build", "certificates.json");
    const projectPath = join(variant.root, ".snapback", "build", "project.json");
    const certificates = JSON.parse(await readFile(certificatesPath, "utf8"));
    const project = JSON.parse(await readFile(projectPath, "utf8"));
    const facts = certificateFacts(certificates, generation);
    builds.push({ label: variant.label, certificateCount: Object.keys(certificates).length,
      programCount: Array.isArray(project.programs) ? project.programs.length : null,
      certificates: await fileIdentity(certificatesPath), project: await fileIdentity(projectPath),
      postPlanHash: facts.post.plan_hash, digest500Site: facts.digest500Site });
  }
  return { generatedTypescript: variants.map((item) => item.seed), syntax, checks, builds };
}

function p95(samples) { return [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1]; }
function setupElapsed(started, label) {
  const elapsedMs = performance.now() - started;
  if (elapsedMs > setupBudgetMs) fail(`${label} exceeded owned setup budget`, { elapsedMs, setupBudgetMs });
  return elapsedMs;
}
async function setupScale(createClient, api, url, total) {
  const started = performance.now();
  for (let first = 0; first < total - 1; first += setupBatchSize) {
    const clients = [];
    try {
      const count = Math.min(setupBatchSize, total - 1 - first);
      for (let offset = 0; offset < count; offset += 1) {
        const suffix = String(first + offset).padStart(4, "0");
        clients.push({ suffix, client: createClient({ url, persona: `scale-${suffix}` }) });
      }
      const results = await Promise.all(clients.map(({ client, suffix }) => client.mutation(api.follows.setFollow,
        { target: "dev:alice", following: true, mutationId: `scale-follow-${suffix}` })));
      results.forEach((result, index) => {
        if (result.state !== "committed") fail(`scale follow ${clients[index].suffix} was not committed`, result);
      });
    } finally { await Promise.all(clients.map(({ client }) => client.close())); }
    setupElapsed(started, "scale follow setup");
  }
  return { method: "follows.setFollow through current headless client", mutations: total - 1,
    batchSize: setupBatchSize, elapsedMs: setupElapsed(started, "scale follow setup") };
}
async function scaleArm(options, followers) {
  const samplePath = join(options.variant.root, ".snapback", `scale-${followers}.json`);
  const owned = await withOwnedOwner(options, async ({ url }) => {
    const setup = await setupScale(options.createClient, options.api, url, followers);
    const alice = options.createClient({ url, persona: "alice" });
    try {
      const count = await alice.query(options.api.profiles.counts, { person: "dev:alice" });
      if (!("data" in count) || count.data?.followers !== followers) fail("follower count differed", count);
      const all = [];
      for (let index = 0; index < warmups + measured; index += 1) {
        const started = performance.now();
        const result = await alice.mutation(options.api.posts.createPost,
          { body: `follower scale ${followers} sample ${index}`, postId: `follower-scale-${followers}-${index}` });
        const elapsed = performance.now() - started;
        if (result.state !== "committed") fail(`post sample ${index} was not committed`, result);
        all.push(elapsed);
      }
      const samples = all.slice(warmups);
      const sample = { format: "clique-follower-scale-arm-v2", followers,
        observedFollowerCount: count.data.followers, warmups: all.slice(0, warmups), samples,
        p95Ms: p95(samples), sampleCount: samples.length, setup,
        postPath: "posts.createPost explicit-id branch" };
      await writeFile(samplePath, `${JSON.stringify(sample, null, 2)}\n`);
      return sample;
    } finally { await alice.close(); }
  });
  return { ...owned, rawSample: await fileIdentity(samplePath) };
}
async function control(owner, path, body) {
  const response = await boundedJsonRequest(`${owner.url}${path}`, { method: "POST",
    headers: { "content-type": "application/json", "x-snapback-control": owner.secret }, body: JSON.stringify(body) });
  if (!response.ok) fail(`control ${path} returned ${response.status}`, response.value);
  return response.value;
}
async function pollDigest(reader, api, sourcePeriod, budgetMs) {
  const started = performance.now();
  let polls = 0;
  while (performance.now() - started <= budgetMs) {
    polls += 1;
    const pushes = await reader.query(api.messages.pushRecent, { c: null });
    const digest = "data" in pushes && Array.isArray(pushes.data)
      ? pushes.data.find((row) => row.kind === "digest" && row.periodStart === sourcePeriod)
      : undefined;
    if (digest) return { digest, polls, elapsedMs: performance.now() - started };
    await new Promise((done) => setTimeout(done, 10));
  }
  return { digest: undefined, polls, elapsedMs: performance.now() - started };
}
async function digestArm(options) {
  const samplePath = join(options.variant.root, ".snapback", "digest-500.json");
  const owned = await withOwnedOwner(options, async (owner) => {
    const reader = options.createClient({ url: owner.url, persona: "digest-reader" });
    const writer = options.createClient({ url: owner.url, persona: "zzzz-activity" });
    try {
      const started = performance.now();
      for (let first = 0; first < 500; first += setupBatchSize) {
        const indices = Array.from({ length: Math.min(setupBatchSize, 500 - first) }, (_, offset) => first + offset);
        const results = await Promise.all(indices.map((index) => {
          const suffix = String(index).padStart(3, "0");
          return reader.mutation(options.api.follows.setFollow, { following: true,
            target: index === 499 ? "dev:zzzz-activity" : `dev:digest-author-${suffix}`,
            mutationId: `digest-500-follow-${suffix}` });
        }));
        results.forEach((result, index) => {
          if (result.state !== "committed") fail(`digest follow ${indices[index]} was not committed`, result);
        });
        setupElapsed(started, "digest follow setup");
      }
      const setup = { method: "follows.setFollow through current headless client", mutations: 500,
        batchSize: setupBatchSize, elapsedMs: setupElapsed(started, "digest follow setup") };
      const count = await reader.query(options.api.profiles.counts, { person: "dev:digest-reader" });
      if (!("data" in count) || count.data?.following !== 500) fail("500-follow count differed", count);
      const post = await writer.mutation(options.api.posts.createPost,
        { body: "activity at the lexicographically last follow edge", postId: "digest-500-last-edge-activity" });
      if (post.state !== "committed") fail("digest source post was not committed", post);
      const sourcePeriod = post.data?.periodStart;
      if (typeof sourcePeriod !== "number") fail("source post omitted its actual period", post);
      const controlClockSteps = [];
      let observed;
      for (let step = 1; step <= digestAdvanceSteps; step += 1) {
        const clock = await control(owner, "/control/clock", { advanceMs: digestAdvanceMs });
        const poll = await pollDigest(reader, options.api, sourcePeriod, digestPollBudgetMs / digestAdvanceSteps);
        controlClockSteps.push({ step, advanceMs: digestAdvanceMs, clock,
          polls: poll.polls, pollElapsedMs: poll.elapsedMs, matchedSourcePeriod: poll.digest !== undefined });
        if (poll.digest) { observed = poll.digest; break; }
      }
      if (!observed || observed.periodEnd !== sourcePeriod + 120_000 || observed.newPostsInFollowing !== 1) {
        fail("500-follow digest for the source post period differed", { sourcePeriod, observed, controlClockSteps });
      }
      const sample = { format: "clique-digest-500-v2", following: count.data.following,
        activityAuthor: "dev:zzzz-activity", orderingWitness: "lexicographically last of 500 followed principals",
        setup, sourcePost: { id: post.data.id, periodStart: sourcePeriod },
        controlClockSteps, digest: observed,
        effectExecutionClaim: "none; reads the durable digest row without inspecting effect settlement" };
      await writeFile(samplePath, `${JSON.stringify(sample, null, 2)}\n`);
      return sample;
    } finally { await Promise.all([reader.close(), writer.close()]); }
  });
  return { ...owned, rawSample: await fileIdentity(samplePath) };
}

async function main() {
  const handoff = requirePath("--handoff"), generation = requireGeneration();
  const binary = requirePath("--binary"), compiler = requirePath("--compiler"), client = requirePath("--client");
  const work = requirePath("--work"), output = resolve(argument("--output") ?? join(work, "follower-scale-receipt.json"));
  if (!(await stat(handoff)).isDirectory()) fail("handoff is not a directory", handoff);
  await mkdir(work, { recursive: false });
  const pids = [];
  const five = { label: "followers-5", ...await prepareVariant(handoff, join(work, "followers-5"), (seed) => withFollowerPrincipals(seed, 5)) };
  const nineHundred = { label: "followers-900", ...await prepareVariant(handoff, join(work, "followers-900"), (seed) => withFollowerPrincipals(seed, 900)) };
  const digest = { label: "digest-500", ...await prepareVariant(handoff, join(work, "digest-500"), withDigestPrincipals) };
  const variants = [five, nineHundred, digest];
  const certificatesPath = join(handoff, ".snapback", "build", "certificates.json");
  const projectPath = join(handoff, ".snapback", "build", "project.json");
  const certificates = JSON.parse(await readFile(certificatesPath, "utf8"));
  const project = JSON.parse(await readFile(projectPath, "utf8"));
  const facts = certificateFacts(certificates, generation);
  const schemaPath = join(handoff, "snapback", "schema.q"), schemaSource = await readFile(schemaPath, "utf8");
  const envelopeLines = ["cap 500 by follower", "cap 100 by principal", "cap 50 by conversationId"];
  envelopeLines.forEach((line) => { if (!schemaSource.includes(line)) fail(`schema lacks ${line}`); });
  const audit = await auditVariants(variants, binary, compiler, generation, pids);
  const schemaIdentity = await fileIdentity(schemaPath);
  for (const variant of variants) {
    const copied = await fileIdentity(join(variant.root, "snapback", "schema.q"));
    if (copied.sha256 !== schemaIdentity.sha256) fail(`${variant.label} changed schema`, copied);
  }
  const sdk = await import(pathToFileURL(client).href);
  if (typeof sdk.createClient !== "function" || sdk.api === undefined) fail("current client exports absent");
  const common = { binary, compiler, generation, pids, createClient: sdk.createClient, api: sdk.api };
  const fiveRun = await scaleArm({ ...common, variant: five }, 5);
  const nineHundredRun = await scaleArm({ ...common, variant: nineHundred }, 900);
  const digestRun = await digestArm({ ...common, variant: digest });
  const ratio = nineHundredRun.value.p95Ms / fiveRun.value.p95Ms;
  const passed = Number.isFinite(ratio) && ratio <= 3;
  const proofPath = fileURLToPath(import.meta.url), helperPath = resolve(proofPath, "../follower-scale-runtime.mjs");
  const receipt = {
    format: "clique-follower-scale-v2", verdict: passed ? "pass" : "fail",
    requirement: "900-follower post write p95 <= 3x five-follower control",
    metric: { controlP95Ms: fiveRun.value.p95Ms, scaledP95Ms: nineHundredRun.value.p95Ms,
      ratio, ceiling: 3, warmups, measured, samplesPerArm: measured },
    constantWork: { generation, planHash: facts.post.plan_hash, readSites: facts.post.read_sites,
      writeSites: facts.post.write_sites, followerTableReads: facts.followerReadSites,
      followerTableWrites: facts.followerWriteSites, exactReadBounds: facts.readBounds,
      exactWriteBounds: facts.writeBounds,
      note: "both arms execute the unchanged posts.createPost certificate after setup; the one _timers Update max_rows 2 certificate site covers its two source branches" },
    envelopes: { retainedSchemaLines: envelopeLines, schema: schemaIdentity,
      assertions: { scaleMaxOutgoingFollowsPerFollower: 1, digestReaderOutgoingFollows: 500,
        membershipsPerPrincipalUnchangedMaximum: 2, membershipsPerConversationUnchangedMaximum: 2 },
      note: "copied schemas are byte-identical; setup changes no memberships or ceiling" },
    digest500: { certificateSite: facts.digest500Site, run: digestRun }, audit,
    source: { handoff, handoffSnapback: await treeIdentity(join(handoff, "snapback")), generation,
      programCount: Array.isArray(project.programs) ? project.programs.length : null,
      certificateCount: Object.keys(certificates).length, certificates: await fileIdentity(certificatesPath),
      project: await fileIdentity(projectPath), posts: await fileIdentity(join(handoff, "snapback", "posts.q")),
      admin: await fileIdentity(join(handoff, "snapback", "admin.q")), proof: await fileIdentity(proofPath),
      helper: await fileIdentity(helperPath), variants: { five, nineHundred, digest } },
    toolchain: { binary: await fileIdentity(binary), compiler: await fileIdentity(compiler), client: await fileIdentity(client),
      node: process.version, nodeComponents: process.versions, executable: process.execPath,
      host: { arch: arch(), hostname: hostname(), platform: platform(), release: release() },
      rustupToolchain: process.env.RUSTUP_TOOLCHAIN ?? null },
    setupBudget: { milliseconds: setupBudgetMs, batchSize: setupBatchSize, journeyTimeoutUsed: false },
    driverPid: process.pid, launchedPids: pids, arms: { five: fiveRun, nineHundred: nineHundredRun },
  };
  await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ verdict: receipt.verdict, metric: receipt.metric, output: await fileIdentity(output) })}\n`);
  if (!passed) process.exitCode = 1;
}
if (resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
