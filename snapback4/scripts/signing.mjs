import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function command(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    throw new Error(`${cmd} failed: ${error.stderr?.toString().trim() || error.message}`, { cause: error });
  }
}

export function signingIdentity(env = process.env) {
  if (env.SNAPBACK4_SIGN_IDENTITY?.trim()) return env.SNAPBACK4_SIGN_IDENTITY.trim();
  const identities = [...command("security", ["find-identity", "-v", "-p", "codesigning"])
    .matchAll(/^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"(Developer ID Application: [^"]+)"\s*$/gm)];
  if (identities.length !== 1) {
    const problem = identities.length ? `multiple Developer ID Application identities (${identities.map(m => m[2]).join("; ")})` : "no Developer ID Application identity in the keychain";
    throw new Error(`${problem}; set SNAPBACK4_SIGN_IDENTITY to choose a Developer ID Application signing identity`);
  }
  return identities[0][1];
}

export function signDeveloperId(binary, identity = signingIdentity()) {
  command("codesign", ["--force", "--sign", identity, "--options", "runtime", "--timestamp", binary]);
  return verifyDeveloperId(binary);
}

export function verifyDeveloperId(binary) {
  command("codesign", ["--verify", "--strict", "--verbose=2", binary]);
  // codesign writes its display information to stderr even on success.
  const display = spawnSync("codesign", ["--display", "--verbose=4", binary], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (display.error || display.status !== 0) throw new Error(`codesign display failed: ${display.stderr?.trim() || display.error?.message || `exit ${display.status}`}`);
  const details = display.stderr;
  const signingAuthority = details.match(/^Authority=(Developer ID Application: .+)$/m)?.[1];
  const signingTeamId = details.match(/^TeamIdentifier=([A-Z0-9]+)$/m)?.[1];
  if (!signingAuthority || !signingTeamId) throw new Error("signature is missing a Developer ID Application authority and team id");
  return { signingAuthority, signingTeamId };
}

export function notarize(binary, profile) {
  const work = mkdtempSync(join(tmpdir(), "snapback4-notary-"));
  try {
    const archive = join(work, "snapback4.zip");
    command("ditto", ["-c", "-k", "--keepParent", binary, archive]);
    let output, failure;
    try {
      output = command("xcrun", ["notarytool", "submit", archive, "--keychain-profile", profile, "--wait", "--output-format", "json"]);
    } catch (error) {
      failure = error;
      output = error.cause?.stdout?.toString();
    }
    let submission;
    try { submission = JSON.parse(output); } catch { /* Refuse malformed or absent service responses below. */ }
    const id = submission?.id;
    if (failure || submission?.status !== "Accepted" || typeof id !== "string" || !id.trim()) {
      throw new Error(`notarization refused: status ${submission?.status ?? "unknown"}; log id ${id ?? "unavailable"}${failure ? `; ${failure.message}` : ""}`);
    }
    // A bare Mach-O binary cannot be stapled; Apple's service holds its ticket.
    return { notarized: true, notarySubmissionId: id };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export function signForPublication(binary, version, env = process.env) {
  const signature = signDeveloperId(binary, signingIdentity(env));
  const profile = env.SNAPBACK4_NOTARY_PROFILE?.trim();
  if (profile) return { ...signature, ...notarize(binary, profile) };
  console.log(`publish: snapback4 ${version} is signed but NOT notarized (set SNAPBACK4_NOTARY_PROFILE)`);
  return { ...signature, notarized: false, notarySubmissionId: null };
}
