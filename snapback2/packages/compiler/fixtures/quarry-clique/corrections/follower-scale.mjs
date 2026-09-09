#!/usr/bin/env node

// Run from an isolated proof directory on the measurement host:
// node follower-scale.mjs \
//   --handoff /absolute/read-only-owner-handoff \
//   --generation <64-hex-generation> \
//   --binary /absolute/snapback2 \
//   --compiler /absolute/compiler.mjs \
//   --work /absolute/new-empty-run-directory
// The driver copies the handoff into three children of --work; it never edits
// the handoff, raises a schema/certificate ceiling, or contacts a provider.

import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { arch, hostname, platform, release } from "node:os";
import { spawn } from "node:child_process";

const warmups = 3;
const measured = 20;

function fail(message, value) {
  throw new Error(value === undefined ? message : `${message}: ${JSON.stringify(value)}`);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requireArgument(name) {
  const value = argument(name);
  if (!value) fail(`missing ${name}`);
  return resolve(value);
}

function requireGeneration() {
  const value = argument("--generation");
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    fail("--generation must be a 64-character lowercase hex digest", value);
  }
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

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
  const hash = createHash("sha256");
  const files = await filesBelow(root);
  for (const file of files) {
    const bytes = await readFile(join(root, file));
    hash.update(file).update("\0").update(sha256(bytes)).update("\0");
  }
  return { files: files.length, sha256: hash.digest("hex") };
}

function replaceOnce(source, anchor, replacement, label) {
  const first = source.indexOf(anchor);
  if (first < 0 || source.indexOf(anchor, first + anchor.length) >= 0) {
    fail(`seed anchor ${label} was not unique`);
  }
  return source.slice(0, first) + replacement + source.slice(first + anchor.length);
}

const profileAnchor = "      { id: \"profile-bob\", principal: \"dev:bob\", displayName: \"Bob\", handle: \"dev_bob\", bio: \"\", location: \"\" },\n";
const followAnchor = "      { id: \"follow-bob-alice\", follower: \"dev:bob\", followed: \"dev:alice\", mutationId: \"seed-follow-bob-alice\", digestEligible: true, at: 1 },\n";
const digestFollowAnchor = "      { id: \"digest-follow-bob-alice\", follower: \"dev:bob\", followed: \"dev:alice\" },\n";
const personasAnchor = "  personas: [\"alice\", \"bob\", \"charlie\", \"count-probe\", \"count-peer\"],";

function followerRows(total) {
  const profiles = [];
  const follows = [];
  const mirrors = [];
  for (let index = 0; index < total - 1; index += 1) {
    const suffix = String(index).padStart(4, "0");
    profiles.push(`      { id: "scale-profile-${suffix}", principal: "dev:scale-${suffix}", displayName: "Scale ${suffix}", handle: "scale_${suffix}", bio: "", location: "" },`);
    follows.push(`      { id: "scale-follow-${suffix}", follower: "dev:scale-${suffix}", followed: "dev:alice", mutationId: "scale-follow-${suffix}", digestEligible: true, periodStart: 1, at: 1 },`);
    mirrors.push(`      { id: "scale-digest-follow-${suffix}", follower: "dev:scale-${suffix}", followed: "dev:alice" },`);
  }
  return { profiles, follows, mirrors };
}

function withFollowers(seed, total) {
  const rows = followerRows(total);
  let output = replaceOnce(seed, profileAnchor, `${profileAnchor}${rows.profiles.join("\n")}\n`, "profiles");
  output = replaceOnce(output, followAnchor, `${followAnchor}${rows.follows.join("\n")}\n`, "follows");
  output = replaceOnce(output, digestFollowAnchor, `${digestFollowAnchor}${rows.mirrors.join("\n")}\n`, "digestFollows");
  return output;
}

function digest500Rows() {
  const profiles = [
    "      { id: \"0-digest-reader\", principal: \"dev:digest-reader\", displayName: \"Digest Reader\", handle: \"digest_reader\", bio: \"\", location: \"\" },",
    "      { id: \"digest-writer\", principal: \"dev:zzzz-activity\", displayName: \"Digest Writer\", handle: \"digest_writer\", bio: \"\", location: \"\" },",
  ];
  const followed = [];
  for (let index = 0; index < 499; index += 1) {
    const suffix = String(index).padStart(3, "0");
    const principal = `dev:digest-author-${suffix}`;
    profiles.push(`      { id: "digest-author-profile-${suffix}", principal: "${principal}", displayName: "Digest Author ${suffix}", handle: "digest_${suffix}", bio: "", location: "" },`);
    followed.push(principal);
  }
  followed.push("dev:zzzz-activity");
  const follows = followed.map((principal, index) => {
    const suffix = String(index).padStart(3, "0");
    return `      { id: "digest-500-follow-${suffix}", follower: "dev:digest-reader", followed: "${principal}", mutationId: "digest-500-follow-${suffix}", digestEligible: true, periodStart: 1, at: 1 },`;
  });
  const mirrors = followed.map((principal, index) => {
    const suffix = String(index).padStart(3, "0");
    return `      { id: "digest-500-mirror-${suffix}", follower: "dev:digest-reader", followed: "${principal}" },`;
  });
  return { profiles, follows, mirrors };
}

function withDigest500(seed) {
  const rows = digest500Rows();
  let output = replaceOnce(
    seed,
    personasAnchor,
    "  personas: [\"alice\", \"bob\", \"charlie\", \"count-probe\", \"count-peer\", \"digest-reader\", \"zzzz-activity\"],",
    "personas",
  );
  output = replaceOnce(output, profileAnchor, `${profileAnchor}${rows.profiles.join("\n")}\n`, "profiles");
  output = replaceOnce(output, followAnchor, `${followAnchor}${rows.follows.join("\n")}\n`, "follows");
  output = replaceOnce(output, digestFollowAnchor, `${digestFollowAnchor}${rows.mirrors.join("\n")}\n`, "digestFollows");
  return output;
}

const journeySource = `import { api } from "snapback2/client";
import { journey } from "snapback2/test";
// @ts-ignore -- proof-only raw receipt output under the Node journey runner.
import { writeFile } from "node:fs/promises";
declare const process: { env: Record<string, string | undefined> };

function percentile95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1]!;
}

journey("post write follower scale", async ({ as }) => {
  const followers = Number(process.env.CLIQUE_SCALE_FOLLOWERS);
  const output = process.env.CLIQUE_SCALE_SAMPLE;
  if (!Number.isSafeInteger(followers) || !output) throw new Error("scale proof environment is absent");
  const alice = as("alice");
  try {
    const count = await alice.query(api.profiles.counts, { person: "dev:alice" });
    if (!("data" in count) || count.data?.followers?.value !== followers) {
      throw new Error(\`seeded follower count was \${JSON.stringify(count)}\`);
    }
    const all: number[] = [];
    for (let index = 0; index < ${warmups + measured}; index += 1) {
      const started = performance.now();
      const result = await alice.mutation(api.posts.createPost, {
        body: \`follower scale \${followers} sample \${index}\`,
        postId: \`follower-scale-\${followers}-\${index}\`,
      });
      const elapsed = performance.now() - started;
      if (result.state !== "committed") throw new Error(\`post sample \${index} was \${result.state}\`);
      all.push(elapsed);
    }
    const samples = all.slice(${warmups});
    await writeFile(output, \`\${JSON.stringify({
      format: "clique-follower-scale-arm-v1",
      followers,
      observedFollowerCount: count.data.followers.value,
      warmups: all.slice(0, ${warmups}),
      samples,
      p95Ms: percentile95(samples),
      sampleCount: samples.length,
      postPath: "posts.createPost explicit-id branch",
    }, null, 2)}\\n\`);
  } finally {
    alice.close();
  }
});

journey("digest reads the full 500-follow envelope", async ({ as, tick }) => {
  const output = process.env.CLIQUE_SCALE_SAMPLE;
  if (!output) throw new Error("digest proof environment is absent");
  const reader = as("digest-reader");
  const writer = as("zzzz-activity");
  try {
    const count = await reader.query(api.profiles.counts, { person: "dev:digest-reader" });
    if (!("data" in count) || count.data?.following?.value !== 500) {
      throw new Error(\`seeded following count was \${JSON.stringify(count)}\`);
    }
    const post = await writer.mutation(api.posts.createPost, {
      body: "activity at the lexicographically last follow edge",
      postId: "digest-500-last-edge-activity",
    });
    if (post.state !== "committed") throw new Error(\`digest source post was \${post.state}\`);
    const started = performance.now();
    await tick(120_000);
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const pushes = await reader.query(api.messages.pushRecent, { c: null });
      const digest = "data" in pushes && Array.isArray(pushes.data)
        ? pushes.data.find((row) => row.kind === "digest")
        : undefined;
      if (digest) {
        if (digest.newPostsInFollowing !== 1) throw new Error(\`500-follow digest was \${JSON.stringify(digest)}\`);
        await writeFile(output, \`\${JSON.stringify({
          format: "clique-digest-500-v1",
          following: count.data.following.value,
          activityAuthor: "dev:zzzz-activity",
          orderingWitness: "activity author is the lexicographically last of 500 followed principals",
          digest,
          elapsedMs: performance.now() - started,
        }, null, 2)}\\n\`);
        return;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    throw new Error("500-follow digest did not appear");
  } finally {
    reader.close();
    writer.close();
  }
});
`;

async function prepareVariant(handoff, root, seedTransform) {
  await cp(handoff, root, { recursive: true, force: false, errorOnExist: true });
  await rm(join(root, ".snapback", "receipts"), { recursive: true, force: true });
  await rm(join(root, ".snapback", "owner.json"), { force: true });
  const snapbackEntries = await readdir(join(root, ".snapback"));
  for (const entry of snapbackEntries) {
    if (entry.startsWith("test-run-") || (entry.startsWith("test-") && entry.endsWith(".sqlite"))) {
      await rm(join(root, ".snapback", entry), { recursive: true, force: true });
    }
  }
  const seedPath = join(root, "snapback", "seed.ts");
  const source = await readFile(seedPath, "utf8");
  await writeFile(seedPath, seedTransform(source));
  await writeFile(join(root, "snapback", "tests", "follower-scale.test.ts"), journeySource);
  return {
    root,
    seed: await fileIdentity(seedPath),
    journey: await fileIdentity(join(root, "snapback", "tests", "follower-scale.test.ts")),
  };
}

async function run(binary, compiler, cwd, journey, samplePath, followers, pidRecord, expectedGeneration) {
  const stdoutPath = join(cwd, ".snapback", `${basename(samplePath, ".json")}.stdout.jsonl`);
  const stderrPath = join(cwd, ".snapback", `${basename(samplePath, ".json")}.stderr.log`);
  const child = spawn(binary, ["test", "--journey", journey, "--json"], {
    cwd,
    env: {
      ...process.env,
      SNAPBACK2_COMPILER: compiler,
      CLIQUE_SCALE_SAMPLE: samplePath,
      ...(followers === undefined ? {} : { CLIQUE_SCALE_FOLLOWERS: String(followers) }),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  pidRecord.push({ command: [binary, "test", "--journey", journey, "--json"], pid: child.pid });
  process.stdout.write(`${JSON.stringify({ event: "launched", journey, pid: child.pid })}\n`);
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => signal ? reject(new Error(`test process ended by ${signal}`)) : resolveExit(code));
  });
  const stdoutBytes = Buffer.concat(stdout);
  const stderrBytes = Buffer.concat(stderr);
  await writeFile(stdoutPath, stdoutBytes);
  await writeFile(stderrPath, stderrBytes);
  if (exitCode !== 0) fail(`journey ${journey} exited ${exitCode}`, { stdout: stdoutBytes.toString(), stderr: stderrBytes.toString() });
  const receiptDirectory = join(cwd, ".snapback", "receipts");
  const receipts = (await readdir(receiptDirectory)).filter((entry) => entry.endsWith(".json")).sort();
  if (receipts.length !== 1) fail(`journey ${journey} left ${receipts.length} receipts`, receipts);
  const receiptPath = join(receiptDirectory, receipts[0]);
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  if (receipt.verdict !== "pass" || receipt.generation !== expectedGeneration) {
    fail(`journey ${journey} receipt differed`, receipt);
  }
  return {
    exitCode,
    pid: child.pid,
    rawReceipt: await fileIdentity(receiptPath),
    rawSample: await fileIdentity(samplePath),
    stderr: await fileIdentity(stderrPath),
    stdout: await fileIdentity(stdoutPath),
    receipt,
    sample: JSON.parse(await readFile(samplePath, "utf8")),
  };
}

async function main() {
  const handoff = requireArgument("--handoff");
  const expectedGeneration = requireGeneration();
  const binary = requireArgument("--binary");
  const compiler = requireArgument("--compiler");
  const work = requireArgument("--work");
  const output = resolve(argument("--output") ?? join(work, "follower-scale-receipt.json"));
  if ((await stat(handoff)).isDirectory() !== true) fail("handoff is not a directory", handoff);
  await mkdir(work, { recursive: false });

  const certificatesPath = join(handoff, ".snapback", "build", "certificates.json");
  const projectPath = join(handoff, ".snapback", "build", "project.json");
  const certificates = JSON.parse(await readFile(certificatesPath, "utf8"));
  const certificateCount = Object.keys(certificates).length;
  const project = JSON.parse(await readFile(projectPath, "utf8"));
  const programCount = Array.isArray(project.programs) ? project.programs.length : undefined;
  const generations = [...new Set(Object.values(certificates).map((certificate) => certificate.schema_hash))];
  if (programCount === undefined || generations.length !== 1 || generations[0] !== expectedGeneration) {
    fail("handoff generation identity differed", { certificateCount, programCount, generations });
  }
  const postCertificate = certificates["posts.createPost"];
  const postReadTables = postCertificate.read_sites.map((site) => site.table);
  const postWriteTables = postCertificate.write_sites.map((site) => site.table);
  if (postReadTables.includes("follows") || postReadTables.includes("digestFollows")
    || postWriteTables.includes("follows") || postWriteTables.includes("digestFollows")
    || postCertificate.read_sites.some((site) => site.max_calls !== 1)) {
    fail("post certificate scales with follower rows", {
      reads: postCertificate.read_sites,
      writes: postCertificate.write_sites,
    });
  }
  const digestCertificate = certificates["admin.digestSweep"];
  const digest500Site = digestCertificate.read_sites.find((site) =>
    site.table === "digestFollows" && site.take === 500);
  if (!digest500Site) fail("digest certificate lacks its 500-follow read", digestCertificate.read_sites);
  const schemaSource = await readFile(join(handoff, "snapback", "schema.q"), "utf8");
  const envelopeLines = [
    "cap 500 by follower",
    "cap 100 by principal",
    "cap 50 by conversationId",
  ];
  for (const line of envelopeLines) {
    if (!schemaSource.includes(line)) fail(`schema no longer retains ${line}`);
  }

  const pids = [];
  const five = await prepareVariant(handoff, join(work, "followers-5"), (seed) => withFollowers(seed, 5));
  const nineHundred = await prepareVariant(handoff, join(work, "followers-900"), (seed) => withFollowers(seed, 900));
  const digest = await prepareVariant(handoff, join(work, "digest-500"), withDigest500);

  const fiveRun = await run(binary, compiler, five.root, "post write follower scale", join(five.root, ".snapback", "scale-5.json"), 5, pids, expectedGeneration);
  const nineHundredRun = await run(binary, compiler, nineHundred.root, "post write follower scale", join(nineHundred.root, ".snapback", "scale-900.json"), 900, pids, expectedGeneration);
  const digestRun = await run(binary, compiler, digest.root, "digest reads the full 500-follow envelope", join(digest.root, ".snapback", "digest-500.json"), undefined, pids, expectedGeneration);

  const ratio = nineHundredRun.sample.p95Ms / fiveRun.sample.p95Ms;
  const passed = Number.isFinite(ratio) && ratio <= 3;
  const proofPath = fileURLToPath(import.meta.url);
  const receipt = {
    format: "clique-follower-scale-v1",
    verdict: passed ? "pass" : "fail",
    requirement: "900-follower post write p95 <= 3x five-follower control",
    metric: {
      controlP95Ms: fiveRun.sample.p95Ms,
      scaledP95Ms: nineHundredRun.sample.p95Ms,
      ratio,
      ceiling: 3,
      warmups,
      measured,
    },
    constantWork: {
      generation: expectedGeneration,
      certificate: {
        maxClosureBytes: postCertificate.max_closure_bytes,
        maxExamined: postCertificate.max_examined,
        maxHeapBytes: postCertificate.max_heap_bytes,
        maxIndexEntries: postCertificate.max_index_entries,
        maxRuleProbes: postCertificate.max_rule_probes,
        maxSteps: postCertificate.max_steps,
        planHash: postCertificate.plan_hash,
        readSites: postCertificate.read_sites,
        writeSites: postCertificate.write_sites,
      },
      followerTableReads: postReadTables.filter((table) => table === "follows" || table === "digestFollows"),
      followerTableWrites: postWriteTables.filter((table) => table === "follows" || table === "digestFollows"),
      note: "both arms execute the same posts.createPost certificate; follower count is absent from its bounded reads and writes",
    },
    envelopes: {
      retainedSchemaLines: envelopeLines,
      note: "the proof only varies seeded rows and adds journeys; it does not alter schema ceilings",
    },
    digest500: {
      certificateSite: digest500Site,
      run: digestRun,
    },
    source: {
      handoff,
      handoffSnapback: await treeIdentity(join(handoff, "snapback")),
      generation: expectedGeneration,
      programCount,
      certificateCount,
      certificates: await fileIdentity(certificatesPath),
      project: await fileIdentity(projectPath),
      posts: await fileIdentity(join(handoff, "snapback", "posts.q")),
      access: await fileIdentity(join(handoff, "snapback", "access.q")),
      admin: await fileIdentity(join(handoff, "snapback", "admin.q")),
      proof: await fileIdentity(proofPath),
      embeddedJourneySha256: sha256(journeySource),
      variants: { five, nineHundred, digest },
    },
    toolchain: {
      binary: await fileIdentity(binary),
      compiler: await fileIdentity(compiler),
      node: process.version,
      nodeComponents: process.versions,
      executable: process.execPath,
      host: { arch: arch(), hostname: hostname(), platform: platform(), release: release() },
      rustupToolchain: process.env.RUSTUP_TOOLCHAIN ?? null,
    },
    driverPid: process.pid,
    launchedPids: pids,
    arms: { five: fiveRun, nineHundred: nineHundredRun },
  };
  await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
  const outputIdentity = await fileIdentity(output);
  process.stdout.write(`${JSON.stringify({ verdict: receipt.verdict, metric: receipt.metric, output: outputIdentity })}\n`);
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
