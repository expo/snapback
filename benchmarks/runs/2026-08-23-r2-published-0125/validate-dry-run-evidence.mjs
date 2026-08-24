#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateSocialMessengerRunRecord } from "../../tools/social-messenger/record-validator.mjs";

const runRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(runRoot, "../../..");

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function inside(root, path) {
  const value = relative(resolve(root), resolve(path));
  return value === ""
    || (value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value));
}

async function checkedFile(root, logicalPath) {
  if (typeof logicalPath !== "string" || logicalPath.length === 0 || isAbsolute(logicalPath)) {
    throw new Error(`invalid evidence-relative path: ${logicalPath ?? "none"}`);
  }
  const absolute = resolve(root, logicalPath);
  if (!inside(root, absolute)) throw new Error(`evidence path escapes root: ${logicalPath}`);
  if ((await lstat(absolute)).isSymbolicLink()) {
    throw new Error(`evidence path is a symbolic link: ${logicalPath}`);
  }
  const canonicalRoot = await realpath(root);
  const canonical = await realpath(absolute);
  if (!inside(canonicalRoot, canonical) || !(await stat(canonical)).isFile()) {
    throw new Error(`evidence path is not a retained file: ${logicalPath}`);
  }
  return canonical;
}

export async function validateDryRunEvidence(
  evidenceRoot,
  { historicalValidatorBinding = null } = {},
) {
  const root = resolve(evidenceRoot);
  const disposition = JSON.parse(await readFile(
    await checkedFile(root, "validation.json"),
    "utf8",
  ));
  if (disposition.schemaVersion !== "snapback.r2-dry-run-validation.v1" || !disposition.ok) {
    throw new Error("dry-run validation disposition is not an accepted v1 record");
  }
  if (disposition.noModelCellStarted !== true || disposition.validator?.errors?.length !== 0) {
    throw new Error("dry-run disposition does not attest a no-model, zero-error proof");
  }

  const seen = new Set();
  for (const artifact of disposition.artifacts ?? []) {
    if (seen.has(artifact.path)) throw new Error(`duplicate evidence artifact: ${artifact.path}`);
    seen.add(artifact.path);
    const path = await checkedFile(root, artifact.path);
    const bytes = await readFile(path);
    if (bytes.byteLength !== artifact.bytes || sha256(bytes) !== artifact.sha256) {
      throw new Error(`evidence artifact digest mismatch: ${artifact.path}`);
    }
  }
  if (!seen.has(disposition.record.path)) {
    throw new Error("record is absent from the retained artifact inventory");
  }
  const recordPath = await checkedFile(root, disposition.record.path);
  const recordBytes = await readFile(recordPath);
  if (sha256(recordBytes) !== disposition.record.sha256) {
    throw new Error("record digest disagrees with the validation disposition");
  }

  const dispositionSources = disposition.validator.sources ?? {};
  if (historicalValidatorBinding !== null) {
    const declaredIds = Object.keys(dispositionSources).sort();
    const boundIds = Object.keys(historicalValidatorBinding.sources ?? {}).sort();
    if (JSON.stringify(declaredIds) !== JSON.stringify(boundIds)) {
      throw new Error("historical validator source inventory disagrees");
    }
  }
  for (const [sourceId, source] of Object.entries(
    historicalValidatorBinding?.sources ?? dispositionSources,
  )) {
    if (historicalValidatorBinding !== null) {
      const declared = dispositionSources[sourceId];
      if (declared?.path !== source.path || declared?.sha256 !== source.sha256) {
        throw new Error(`historical validator source transition disagrees: ${source.path}`);
      }
      const objectBytes = execFileSync(
        "git",
        ["show", `${historicalValidatorBinding.sourceCommit}:${source.path}`],
        { cwd: repositoryRoot, encoding: null },
      );
      if (sha256(objectBytes) !== source.sha256) {
        throw new Error(`historical validator source object digest disagrees: ${source.path}`);
      }
    } else {
      const bytes = await readFile(resolve(repositoryRoot, source.path));
      if (sha256(bytes) !== source.sha256) {
        throw new Error(`validator source drifted: ${source.path}`);
      }
    }
  }
  if (historicalValidatorBinding !== null) {
    const tree = execFileSync(
      "git",
      ["rev-parse", `${historicalValidatorBinding.sourceCommit}^{tree}`],
      { cwd: repositoryRoot, encoding: "utf8" },
    ).trim();
    if (tree !== historicalValidatorBinding.sourceTree) {
      throw new Error("historical validator source commit/tree binding disagrees");
    }
    return {
      ok: true,
      evidenceRoot: root,
      artifacts: seen.size,
      record: disposition.record,
      status: disposition.status,
      failureProbe: disposition.failureProbe,
      validationErrors: disposition.validator.errors.length,
      validationMode: "immutable-git-object-validator-source-binding",
    };
  }
  const [baseSchema, extensionSchema, composedSchema] = await Promise.all([
    "benchmarks/schema/run-record.schema.json",
    "benchmarks/schema/social-messenger/run-record-extension.schema.json",
    "benchmarks/schema/social-messenger/run-record.schema.json",
  ].map(async (path) => JSON.parse(await readFile(resolve(repositoryRoot, path), "utf8"))));
  const record = JSON.parse(recordBytes);
  const errors = validateSocialMessengerRunRecord(composedSchema, record, {
    schemas: [baseSchema, extensionSchema],
    artifactRoot: dirname(recordPath),
  });
  if (errors.length > 0) {
    throw new Error(`retained dry-run record failed validation: ${errors.join("; ")}`);
  }
  return {
    ok: true,
    evidenceRoot: root,
    artifacts: seen.size,
    record: disposition.record,
    status: disposition.status,
    failureProbe: disposition.failureProbe,
    validationErrors: errors.length,
    validationMode: "current-validator-replay",
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 3 || args[1] !== "--source-binding") {
    throw new Error("usage: validate-dry-run-evidence.mjs <evidence-root> --source-binding <recovery-resume.v3.json>");
  }
  const bindingDocument = JSON.parse(await readFile(resolve(args[2]), "utf8"));
  process.stdout.write(`${JSON.stringify(await validateDryRunEvidence(args[0], {
    historicalValidatorBinding: bindingDocument.historicalDryRunValidator,
  }))}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`R2_DRY_RUN_EVIDENCE_INVALID: ${error.message}\n`);
    process.exitCode = 2;
  });
}
