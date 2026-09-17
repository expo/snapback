// Actual managed-recipe execution through the shared server interpreter.
// These CLI principals/times are operator inputs, not auth/provider/mint proof.
import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binary = process.env.SNAPBACK4_BIN ?? resolve(packageRoot, "../../target/debug/snapback4");
const scratchParentInput = process.env.SNAPBACK4_IDENTITY_PROFILE_SCRATCH_PARENT;
const SERVICE = "service:worker";
const ISSUER_A = "https://issuer-a.example";
const ISSUER_B = "https://issuer-b.example";
const PRINCIPAL_A = "oidc:profile-a";
const PRINCIPAL_B = "oidc:profile-b";

test("managed OIDC profile binding orders and expires trusted email evidence", {
  skip: scratchParentInput ? false : "set SNAPBACK4_IDENTITY_PROFILE_SCRATCH_PARENT to an existing private directory",
}, () => {
  const parent = realpathSync(scratchParentInput);
  assert.ok(parent.length > 1 && resolve(parent) === parent, "scratch parent must resolve to a nonempty canonical path");
  const directory = mkdtempSync(join(parent, "b1d1-profile-"));
  const canonical = realpathSync(directory);
  assert.ok(relative(parent, canonical) && !relative(parent, canonical).startsWith(`..${sep}`), "scratch escaped its private parent");
  let complete = false;
  try {
    mkdirSync(join(canonical, "snapback"));
    copyFileSync(join(packageRoot, "test/fixtures/identity-recipe/snapback/schema.q"), join(canonical, "snapback/schema.q"));

    const invoke = (args, expected = 0) => {
      const result = spawnSync(binary, args, { cwd: canonical, encoding: "utf8", timeout: 20_000 });
      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(result.status, expected, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
      return result.stdout.trim() ? JSON.parse(result.stdout) : null;
    };
    const run = (operation, args, principal, now, expected = 0) => invoke([
      "run", operation, JSON.stringify(args), "--as", principal, "--now", String(now), "--json",
    ], expected);
    const id = n => String(n).padStart(26, "0");
    const beginArgs = (n, expiresAt = 2_000_000) => ({
      id: id(n), beginInvocation: `begin-${n}`, admittingPrincipal: `guest:${n}`,
      configFingerprint: `config-${n}`, bindingHash: `binding-${n}`, state: `state-${n}`,
      nonce: `nonce-${n}`, pkceVerifier: `verifier-${n}`, createdAt: 99, expiresAt,
      completionInvocation: null, verifiedIssuer: null, verifiedSubject: null, email: null, emailVerified: null,
    });
    const begin = (n, now) => run("identityBegin", beginArgs(n), SERVICE, now);
    const claim = (n, completion = `complete-${n}`) => run("identityClaim", {
      id: id(n), completionInvocation: completion,
    }, SERVICE, 100_000);
    const verify = (n, { principal = PRINCIPAL_A, issuer = ISSUER_A, subject = "subject-a",
      email = "person@example.test", emailVerified = true, now = 100_001, actor = SERVICE } = {}, expected = 0) => run("identityVerified", {
      id: id(n), completionInvocation: `complete-${n}`, principal, issuer, subject, email, emailVerified,
    }, actor, now, expected);
    const transaction = n => run("identityByInvocation", { invocation: `begin-${n}` }, SERVICE, 100_002).data;
    const profile = principal => run("identityProfileFor", { principal }, SERVICE, 100_002).data;
    const eligibility = (principal, now) => run("identityOwnProfileEligibility", {}, principal, now).data;

    const checked = invoke(["check", "--json"]);
    assert.equal(checked.ok, true);

    const deniedBegin = run("identityBegin", beginArgs(90), "guest:ordinary", 1_000, 1);
    assert.equal(deniedBegin.state, "failed");
    assert.equal(deniedBegin.why.code, "OIDC_SERVICE_REQUIRED");

    begin(1, 1_000); claim(1); verify(1);
    const first = profile(PRINCIPAL_A);
    assert.equal(first.principal, PRINCIPAL_A);
    assert.equal(first.proofStartedAt, 1_000, "managed now, not caller createdAt, stamps the proof");
    assert.equal(first.proofExpiresAt, 301_000);
    assert.equal(first.emailVerified, true);
    assert.equal(run("identityOwnProfile", {}, "guest:ordinary", 1_001).data, null);
    const deniedTransition = verify(1, { principal: PRINCIPAL_A, actor: "guest:ordinary" }, 1);
    assert.equal(deniedTransition.why.code, "OIDC_SERVICE_REQUIRED");

    begin(2, 2_000); claim(2); verify(2, {
      principal: PRINCIPAL_B, issuer: ISSUER_B, subject: "subject-b", email: "person@example.test",
    });
    assert.equal(profile(PRINCIPAL_A).issuer, ISSUER_A);
    assert.equal(profile(PRINCIPAL_B).issuer, ISSUER_B, "equal email never links distinct issuer/subject principals");

    begin(3, 3_000); claim(3);
    begin(4, 4_000); claim(4); verify(4, { email: "newer@example.test" });
    const newerOrder = profile(PRINCIPAL_A).loginOrder;
    verify(3, { email: "older@example.test", now: 4_500 });
    assert.equal(profile(PRINCIPAL_A).email, "newer@example.test");
    assert.equal(profile(PRINCIPAL_A).loginOrder, newerOrder, "a delayed older completion cannot replace newer evidence");

    begin(5, 5_000); claim(5); verify(5, { email: "newer@example.test", emailVerified: false });
    assert.equal(eligibility(PRINCIPAL_A, 5_001).eligible, false, "newer false verification clears eligibility");
    begin(6, 6_000); claim(6); verify(6, { email: null, emailVerified: null });
    assert.equal(profile(PRINCIPAL_A).email, null);
    assert.equal(eligibility(PRINCIPAL_A, 6_001).eligible, false, "newer missing email clears eligibility");
    begin(7, 7_000); claim(7); verify(7, { email: "changed@example.test" });
    assert.equal(eligibility(PRINCIPAL_A, 306_999).eligible, true);
    assert.equal(eligibility(PRINCIPAL_A, 307_000).eligible, false, "the exact fixed expiry boundary is ineligible");

    const original = profile(PRINCIPAL_A);
    verify(7, { email: "changed@example.test", now: 200_000 });
    assert.deepEqual(profile(PRINCIPAL_A), original, "semantic replay cannot refresh the original proof stamp");

    begin(8, 8_000); claim(8);
    const mismatch = verify(8, { issuer: "https://wrong.example", subject: "wrong" }, 1);
    assert.equal(mismatch.why.code, "OIDC_PROFILE_BINDING");
    const rolledBack = transaction(8);
    assert.equal(rolledBack.verifiedPrincipal, null);
    assert.equal(rolledBack.verifiedIssuer, null, "the transaction update rolls back with the profile refusal");

    const changedRepeat = verify(7, { issuer: ISSUER_A, subject: "different-subject" }, 1);
    assert.equal(changedRepeat.why.code, "OIDC_VERIFIED_MISMATCH");
    complete = true;
  } finally {
    if (complete) rmSync(canonical, { recursive: true, force: true });
    else process.stderr.write(`identity-profile scratch preserved after failure: ${canonical}\n`);
  }
});
