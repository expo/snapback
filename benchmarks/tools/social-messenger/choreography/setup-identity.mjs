import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { validateJsonSchema } from "../../lib/json-schema.mjs";

export const SETUP_IDENTITY_VERSION = "social-messenger.setup-identity.v1";
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/u;
const SETUP_SCHEMA = JSON.parse(await readFile(new URL("./setup-identity.schema.json", import.meta.url), "utf8"));

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function resolveArtifact(root, claim, label) {
  if (!claim || typeof claim !== "object" || typeof claim.claimed !== "boolean") {
    throw new TypeError(`${label} must be an explicit claimed/non-claimed artifact`);
  }
  if (!claim.claimed) {
    requiredString(claim.reason, `${label}.reason`);
    return { claimed: false, reason: claim.reason };
  }
  requiredString(claim.path, `${label}.path`);
  if (!SHA256.test(claim.sha256 ?? "")) throw new TypeError(`${label}.sha256 is invalid`);
  if (isAbsolute(claim.path)) throw new Error(`${label}.path must be relative to setup identity`);
  const path = resolve(root, claim.path);
  const escaped = relative(root, path);
  if (escaped === ".." || escaped.startsWith(`..${sep}`) || isAbsolute(escaped)) {
    throw new Error(`${label}.path escapes setup identity directory`);
  }
  if ((await lstat(path)).isSymbolicLink()) throw new Error(`${label}.path cannot be a symbolic link`);
  const canonicalRoot = await realpath(root);
  const canonicalPath = await realpath(path);
  const canonicalEscape = relative(canonicalRoot, canonicalPath);
  if (
    canonicalEscape === ".."
    || canonicalEscape.startsWith(`..${sep}`)
    || isAbsolute(canonicalEscape)
  ) throw new Error(`${label}.path escapes after canonical resolution`);
  const bytes = await readFile(canonicalPath);
  if (digest(bytes) !== claim.sha256) throw new Error(`${label}.sha256 does not match retained bytes`);
  return { claimed: true, path: claim.path, sha256: claim.sha256 };
}

export function verifySetupToolchain(setup, { browser, playwrightVersion = null }) {
  if (setup.toolchain?.node?.version !== process.version) {
    throw new Error(
      `setup identity Node version differs from runner: declared=${setup.toolchain?.node?.version ?? "none"} actual=${process.version}`,
    );
  }
  if (resolve(setup.toolchain.node.path) !== resolve(process.execPath)) {
    throw new Error("setup identity Node path differs from the runner executable");
  }
  if (setup.toolchain.browser !== browser) {
    throw new Error(`setup identity browser differs: declared=${setup.toolchain.browser ?? "none"} selected=${browser}`);
  }
  if (!SEMVER.test(setup.toolchain.playwright ?? "")) {
    throw new Error("setup identity toolchain.playwright must be an exact semantic version");
  }
  if (playwrightVersion !== null && setup.toolchain.playwright !== playwrightVersion) {
    throw new Error(
      `setup identity Playwright version differs: declared=${setup.toolchain.playwright} loaded=${playwrightVersion}`,
    );
  }
  requiredString(setup.toolchain.bun, "setup identity toolchain.bun");
  requiredString(setup.toolchain.npm, "setup identity toolchain.npm");
}

export async function loadSetupIdentity(path, { browser }) {
  if (!path) throw new Error("--setup-identity / CHOREO_SETUP_IDENTITY is required before choreography startup");
  const absolutePath = resolve(path);
  if ((await lstat(absolutePath)).isSymbolicLink()) throw new Error("setup identity cannot be a symbolic link");
  const bytes = await readFile(absolutePath);
  const setup = JSON.parse(bytes.toString("utf8"));
  const schemaErrors = validateJsonSchema(SETUP_SCHEMA, setup);
  if (schemaErrors.length > 0) {
    throw new Error(`setup identity schema refusal: ${schemaErrors.join("; ")}`);
  }
  if (setup?.schemaVersion !== SETUP_IDENTITY_VERSION) {
    throw new Error(`setup identity must use ${SETUP_IDENTITY_VERSION}`);
  }
  if (setup.instrumentPin !== "social-messenger@0.3.7-m8") {
    throw new Error(`setup identity must pin social-messenger@0.3.7-m8; received ${setup.instrumentPin ?? "none"}`);
  }
  if (!setup.backend || !["snapback", "external"].includes(setup.backend.kind)) {
    throw new Error("setup identity backend.kind must be snapback or external");
  }
  requiredString(setup.backend.version, "setup identity backend.version");
  const qualifiedBinary = await resolveArtifact(
    dirname(absolutePath),
    setup.runtime?.qualifiedBinary,
    "setup identity runtime.qualifiedBinary",
  );
  const wrapper = await resolveArtifact(
    dirname(absolutePath),
    setup.runtime?.wrapper,
    "setup identity runtime.wrapper",
  );
  if (!setup.packageClosure || !["packed", "workspace", "hosted"].includes(setup.packageClosure.mode)) {
    throw new Error("setup identity packageClosure.mode must be packed, workspace, or hosted");
  }
  if (!new Set(["verified", "not-applicable"]).has(setup.packageClosure.prepack)) {
    throw new Error("setup identity packageClosure.prepack must be verified or not-applicable");
  }
  const artifacts = setup.packageClosure.artifacts;
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new Error("setup identity packageClosure.artifacts must be non-empty");
  }
  for (const [index, artifact] of artifacts.entries()) {
    requiredString(artifact?.name, `setup identity package artifact ${index}.name`);
    requiredString(artifact?.version, `setup identity package artifact ${index}.version`);
    if (artifact.sha256 !== null && !SHA256.test(artifact.sha256 ?? "")) {
      throw new Error(`setup identity package artifact ${index}.sha256 is invalid`);
    }
  }
  if (setup.packageClosure.mode === "packed" && setup.packageClosure.prepack !== "verified") {
    throw new Error("packed setup identity requires verified prepack closure");
  }
  if (
    setup.packageClosure.mode === "packed"
    && artifacts.some((artifact) => artifact.sha256 === null)
  ) {
    throw new Error("packed setup identity requires a digest for every package artifact");
  }
  verifySetupToolchain(setup, { browser });
  requiredString(setup.host?.id, "setup identity host.id");
  requiredString(setup.host?.platform, "setup identity host.platform");
  requiredString(setup.host?.arch, "setup identity host.arch");
  return {
    value: {
      ...setup,
      runtime: { qualifiedBinary, wrapper },
    },
    descriptor: {
      path: absolutePath,
      sha256: digest(bytes),
    },
  };
}
