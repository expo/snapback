// B1d.2a source-only qualification for the managed organization recipe.
// Every CLI principal and time is an operator test input, not authentication
// or provider evidence. The parent lane supplies and pins the sha256-capable
// binary; this checkout must not substitute the published 0.2.26 engine.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binaryInput = process.env.SNAPBACK4_B1D_MANAGED_BIN;
const expectedBinarySha256 = process.env.SNAPBACK4_B1D_MANAGED_BIN_SHA256;
const scratchParentInput = process.env.SNAPBACK4_B1D_MANAGED_SCRATCH_PARENT;
const missing = [
  ["SNAPBACK4_B1D_MANAGED_BIN", binaryInput],
  ["SNAPBACK4_B1D_MANAGED_BIN_SHA256", expectedBinarySha256],
  ["SNAPBACK4_B1D_MANAGED_SCRATCH_PARENT", scratchParentInput],
].filter(([, value]) => !value).map(([name]) => name);

const SERVICE = "service:worker";
const OWNER = "oidc:organization-owner";
const ADMIN = "oidc:organization-admin";
const MEMBER = "oidc:organization-member";
const RECIPIENT = "oidc:organization-recipient";
const WRONG_ACCOUNT = "oidc:wrong-account";
const FALSE_PROFILE = "oidc:false-profile";
const MISSING_PROFILE = "oidc:missing-profile";
const STALE_PROFILE = "oidc:stale-profile";
const CASE_PROFILE = "oidc:case-profile";
const SAME_A = "oidc:same-email-a";
const SAME_B = "oidc:same-email-b";
const BOUNDARY_PROFILE = "oidc:proof-boundary";
const LATE_PROFILE = "oidc:late-capacity";
const OTHER_OWNER = "oidc:other-tenant-owner";
const OUTSIDER = "guest:organization-outsider";
const T = 1_000_000;

const QUERY_OPERATIONS = new Set([
  "organizations.organizationPolicy",
  "organizations.ownOrganizations",
  "organizations.memberRoster",
  "organizations.adminInvitations",
  "organizations.invitationMetadata",
  "organizations.invitePreview",
  "organizations.adminAudit",
]);
const MUTATION_OPERATIONS = new Set([
  "organizations.organizationSetPolicy",
  "organizations.organizationCreate",
  "organizations.organizationRecordInvitation",
  "organizations.organizationAcceptInvitation",
  "organizations.organizationRevokeInvitation",
  "organizations.organizationSetMemberRole",
  "organizations.organizationRemoveMember",
  "organizations.organizationLeave",
  "organizations.organizationSetCapacity",
  "identityBegin",
  "identityClaim",
  "identityVerified",
]);
const operationKind = operation => QUERY_OPERATIONS.has(operation) ? "query"
  : MUTATION_OPERATIONS.has(operation) ? "mutation" : null;
const own = (value, key) => Object.hasOwn(value, key);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const queryRefusal = body => object(body) && object(body.denied)
  && typeof body.denied.code === "string" && !own(body, "state") && !own(body, "why");
const mutationRefusal = body => object(body) && body.state === "failed"
  && object(body.why) && typeof body.why.code === "string" && own(body, "current")
  && !own(body, "denied");

function classifyRunResponse(kind, response) {
  if (response.error) return { type: "unsafe", code: "SPAWN_ERROR" };
  if (response.signal !== null && response.signal !== undefined) return { type: "unsafe", code: "SIGNAL" };
  if (response.status !== 0 && response.status !== 1) return { type: "unsafe", code: "EXIT_STATUS" };
  let body;
  try {
    body = JSON.parse(response.stdout);
  } catch {
    return { type: "unsafe", code: "NON_JSON" };
  }
  if (response.status === 0) {
    if (kind === "query") {
      if (!object(body) || !own(body, "data") || body.complete !== true || body.cut !== null
        || body.next !== null || !own(body, "metered")) {
        return { type: "unsafe", code: "QUERY_SUCCESS_ENVELOPE" };
      }
    } else if (!object(body) || body.state !== "sent" || !own(body, "seq")
      || !own(body, "result") || !own(body, "events") || !own(body, "metered")) {
      return { type: "unsafe", code: "MUTATION_SUCCESS_ENVELOPE" };
    }
    return { type: "success", body };
  }
  const expected = kind === "query" ? queryRefusal(body) : mutationRefusal(body);
  if (expected) return {
    type: "refusal", body,
    code: kind === "query" ? body.denied.code : body.why.code,
  };
  const recognizedOtherKind = kind === "query" ? mutationRefusal(body) : queryRefusal(body);
  if (recognizedOtherKind) return { type: "refusal-kind-mismatch", body };
  return { type: "unsafe", code: `${kind.toUpperCase()}_REFUSAL_ENVELOPE` };
}

const response = (status, body, overrides = {}) => ({
  status, signal: null, error: undefined,
  stdout: typeof body === "string" ? body : JSON.stringify(body), stderr: "", ...overrides,
});

test("managed-policy CLI operation inventory excludes actions and jobs", () => {
  assert.equal(QUERY_OPERATIONS.size, 7);
  assert.equal(MUTATION_OPERATIONS.size, 12);
  assert.equal(operationKind("organizations.invitePreview"), "query");
  assert.equal(operationKind("identityVerified"), "mutation");
  assert.equal(operationKind("beginOidc"), null, "generated actions are rejected before spawn");
  assert.equal(operationKind("nightly"), null, "jobs are rejected before spawn");
});

test("managed-policy CLI envelopes are kind-specific and fail closed", () => {
  const querySuccess = { data: [], complete: true, cut: null, next: null, metered: {} };
  const queryDenied = { denied: { code: "QUERY_DENIED" } };
  const mutationSuccess = { state: "sent", seq: 1, result: { id: "1" }, events: [], metered: {} };
  const mutationNull = { ...mutationSuccess, result: null };
  const mutationDenied = { state: "failed", why: { code: "MUTATION_DENIED" }, current: null };
  assert.equal(classifyRunResponse("query", response(0, querySuccess)).type, "success");
  assert.deepEqual(classifyRunResponse("query", response(1, queryDenied)), {
    type: "refusal", body: queryDenied, code: "QUERY_DENIED",
  });
  assert.equal(classifyRunResponse("mutation", response(0, mutationSuccess)).type, "success");
  assert.equal(classifyRunResponse("mutation", response(0, mutationNull)).type, "success");
  assert.deepEqual(classifyRunResponse("mutation", response(1, mutationDenied)), {
    type: "refusal", body: mutationDenied, code: "MUTATION_DENIED",
  });
  assert.equal(classifyRunResponse("query", response(0, { ...querySuccess, complete: false, cut: {} })).code, "QUERY_SUCCESS_ENVELOPE");
  assert.equal(classifyRunResponse("query", response(0, mutationSuccess)).code, "QUERY_SUCCESS_ENVELOPE");
  assert.equal(classifyRunResponse("query", response(1, mutationDenied)).type, "refusal-kind-mismatch");
  assert.equal(classifyRunResponse("mutation", response(1, queryDenied)).type, "refusal-kind-mismatch");
  assert.equal(classifyRunResponse("query", response(0, "{" )).code, "NON_JSON");
  assert.equal(classifyRunResponse("query", response(2, {})).code, "EXIT_STATUS");
  assert.equal(classifyRunResponse("query", response(null, {}, { signal: "SIGTERM" })).code, "SIGNAL");
  assert.equal(classifyRunResponse("mutation", response(1, { error: "input" })).code, "MUTATION_REFUSAL_ENVELOPE");
});

test("managed organization and invitation policy runs in the shared interpreter", {
  skip: missing.length === 0 ? false : `set ${missing.join(", ")} to the pinned parent binary and a private scratch parent`,
}, () => {
  assert.match(expectedBinarySha256, /^[0-9a-f]{64}$/, "expected binary SHA-256 must be explicit lowercase hex");
  assert.ok(isAbsolute(binaryInput), "managed-policy binary path must be absolute");
  const binary = realpathSync(binaryInput);
  assert.equal(binary, resolve(binaryInput), "managed-policy binary path must already be canonical");
  const binaryStat = statSync(binary);
  assert.ok(binaryStat.isFile() && (binaryStat.mode & 0o111) !== 0, "managed-policy binary must be an executable file");
  const actualBinarySha256 = createHash("sha256").update(readFileSync(binary)).digest("hex");
  assert.equal(actualBinarySha256, expectedBinarySha256, "managed-policy binary digest does not match its explicit pin");

  assert.ok(isAbsolute(scratchParentInput), "scratch parent path must be absolute");
  const parent = realpathSync(scratchParentInput);
  assert.ok(parent.length > 1 && parent === resolve(scratchParentInput), "scratch parent must be a non-root canonical path");
  const parentStat = statSync(parent);
  assert.ok(parentStat.isDirectory(), "scratch parent must be an existing directory");
  assert.equal(parentStat.mode & 0o077, 0, "scratch parent must not grant group or other permissions");
  if (typeof process.getuid === "function") assert.equal(parentStat.uid, process.getuid(), "scratch parent must be owned by this user");

  const directory = mkdtempSync(join(parent, "b1d2a-organizations-"));
  const canonical = realpathSync(directory);
  const childRelative = relative(parent, canonical);
  const contained = childRelative.length > 0 && childRelative !== ".."
    && !childRelative.startsWith(`..${sep}`) && !isAbsolute(childRelative);
  assert.ok(canonical.length > parent.length && contained, "scratch child escaped its private parent");
  let complete = false;
  try {
    mkdirSync(join(canonical, "snapback"));
    copyFileSync(join(packageRoot, "test/fixtures/identity-recipe/snapback/schema.q"), join(canonical, "snapback/schema.q"));
    copyFileSync(join(packageRoot, "test/fixtures/identity-recipe/snapback/organizations.q"), join(canonical, "snapback/organizations.q"));
    const canonicalStat = statSync(canonical);
    assert.equal(canonicalStat.mode & 0o077, 0, "scratch child must remain owner-private");
    const responseJournal = join(canonical, "managed-policy-responses.jsonl");
    writeFileSync(responseJournal, "", { flag: "wx", mode: 0o600 });
    const responseJournalStat = statSync(responseJournal);
    assert.ok(responseJournalStat.isFile(), "response journal must be a regular file");
    assert.equal(responseJournalStat.mode & 0o077, 0, "response journal must remain owner-private");
    if (typeof process.getuid === "function") assert.equal(responseJournalStat.uid, process.getuid(), "response journal must be owned by this user");

    let responseSequence = 0;
    const refusalProblems = [];
    const stop = (code, label) => {
      throw new Error(`${code}: ${label}; private responses preserved at ${responseJournal}`);
    };
    const spawnRecorded = (args, label, kind, operatorPrincipal = null, operatorNow = null) => {
      const result = spawnSync(binary, args, {
        cwd: canonical, encoding: "utf8", timeout: 20_000,
      });
      appendFileSync(responseJournal, `${JSON.stringify({
        sequence: ++responseSequence, operation: label, kind,
        operatorPrincipal, operatorNow,
        status: result.status, signal: result.signal,
        rawstdout: result.stdout ?? "", stderr: result.stderr ?? "",
      })}\n`, { encoding: "utf8", mode: 0o600 });
      return result;
    };
    const invokeRun = (operation, args, principal, now) => {
      const kind = operationKind(operation);
      if (kind === null) stop("UNSUPPORTED_OPERATION_KIND", operation);
      const result = spawnRecorded([
        "run", operation, JSON.stringify(args), "--as", principal, "--now", String(now), "--json",
      ], operation, kind, principal, now);
      const outcome = classifyRunResponse(kind, result);
      if (outcome.type === "unsafe") stop(outcome.code, operation);
      return outcome;
    };
    const run = (operation, args, principal, now) => {
      const outcome = invokeRun(operation, args, principal, now);
      if (outcome.type !== "success") stop("EXPECTED_SUCCESS", operation);
      return outcome.body;
    };
    const orgRun = (name, args, principal, now) => run(`organizations.${name}`, args, principal, now);
    const data = result => result.data;
    const written = result => result.result;
    const denied = (name, args, principal, now, code) => {
      const operation = `organizations.${name}`;
      const outcome = invokeRun(operation, args, principal, now);
      if (outcome.type === "success") stop("UNEXPECTED_SUCCESS_FOR_REFUSAL", operation);
      if (outcome.type === "refusal-kind-mismatch") {
        refusalProblems.push(`${operation}: expected ${operationKind(operation)} refusal envelope`);
        return outcome.body;
      }
      if (outcome.code !== code) refusalProblems.push(`${operation}: expected ${code}, received ${outcome.code}`);
      return outcome.body;
    };
    const id = n => String(n).padStart(26, "0");
    const digest = raw => createHash("sha256").update(raw, "utf8").digest("hex");
    let profileNumber = 1000;
    const recordProfile = (principal, email, emailVerified, proofStartedAt) => {
      const n = profileNumber++;
      const tx = id(n);
      run("identityBegin", {
        id: tx, beginInvocation: `organization-profile-${n}`, admittingPrincipal: `guest:profile-${n}`,
        configFingerprint: `config-${n}`, bindingHash: `binding-${n}`, state: `state-${n}`,
        nonce: `nonce-${n}`, pkceVerifier: `verifier-${n}`, createdAt: proofStartedAt - 1,
        expiresAt: proofStartedAt + 1_000_000, completionInvocation: null,
        verifiedIssuer: null, verifiedSubject: null, email: null, emailVerified: null,
      }, SERVICE, proofStartedAt);
      run("identityClaim", { id: tx, completionInvocation: `complete-${n}` }, SERVICE, proofStartedAt + 1);
      run("identityVerified", {
        id: tx, completionInvocation: `complete-${n}`, principal,
        issuer: `https://issuer-${n}.example`, subject: `subject-${n}`, email, emailVerified,
      }, SERVICE, proofStartedAt + 2);
    };
    const roster = (organization, principal, now) => data(orgRun("memberRoster", { organization, c: null }, principal, now));
    const invitations = (organization, principal, now) => data(orgRun("adminInvitations", { organization, c: null }, principal, now));
    const audit = (organization, principal, now) => data(orgRun("adminAudit", { organization, c: null }, principal, now));
    const findInvitation = (organization, invitation, principal, now) => {
      const found = invitations(organization, principal, now).find(row => row.id === invitation);
      assert.ok(found, `invitation ${invitation} must be present in admin history`);
      return found;
    };
    const recordInvitation = (invitation, organization, email, rawToken, principal, now) => written(orgRun("organizationRecordInvitation", {
      id: invitation, organization, recipientEmail: email, tokenHash: digest(rawToken),
    }, principal, now));

    const checkResult = spawnRecorded(["check", "--json"], "check", "check");
    if (checkResult.error) stop("CHECK_SPAWN_ERROR", "check");
    if (checkResult.signal !== null && checkResult.signal !== undefined) stop("CHECK_SIGNAL", "check");
    let checked;
    try {
      checked = JSON.parse(checkResult.stdout);
    } catch {
      stop("CHECK_NON_JSON", "check");
    }
    if (checkResult.status !== 0 || !object(checked) || checked.ok !== true) stop("CHECK_REFUSED", "check");

    for (const [principal, email, verified, started] of [
      [OWNER, "owner@example.test", true, T - 10_000],
      [ADMIN, "admin@example.test", true, T - 10_000],
      [MEMBER, "member@example.test", true, T - 10_000],
      [RECIPIENT, "recipient@example.test", true, T - 10_000],
      [WRONG_ACCOUNT, "wrong@example.test", true, T - 10_000],
      [FALSE_PROFILE, "false@example.test", false, T - 10_000],
      [MISSING_PROFILE, null, null, T - 10_000],
      [STALE_PROFILE, "stale@example.test", true, T - 400_000],
      [CASE_PROFILE, "Case@Example.test", true, T - 10_000],
      [SAME_A, "shared@example.test", true, T - 10_000],
      [SAME_B, "shared@example.test", true, T - 10_000],
      [BOUNDARY_PROFILE, "boundary@example.test", true, T - 295_000],
      [LATE_PROFILE, "late@example.test", true, T - 10_000],
      [OTHER_OWNER, "other-owner@example.test", true, T - 10_000],
    ]) recordProfile(principal, email, verified, started);

    assert.deepEqual(data(orgRun("organizationPolicy", {}, OUTSIDER, T)), {
      invitationLifetimeMs: 604_800_000, defaultSeatLimit: 5,
    }, "the ordinary readable policy exposes only nonsecret defaults");
    denied("organizationSetPolicy", { invitationLifetimeMs: 1000, defaultSeatLimit: 20 }, OUTSIDER, T, "ORGANIZATION_SERVICE_REQUIRED");
    denied("organizationCreate", { name: "No profile" }, OUTSIDER, T, "ORGANIZATION_PROFILE_REQUIRED");

    const organization = written(orgRun("organizationCreate", { name: "Managed Organization" }, OWNER, T));
    assert.equal(organization.owner, OWNER);
    assert.equal(organization.seatLimit, 5);
    assert.deepEqual(roster(organization.id, OWNER, T), [{
      id: roster(organization.id, OWNER, T)[0].id,
      principal: OWNER, role: "admin", joinedAt: T, sourceInvitation: null,
    }], "organization creation bootstraps one owner admin in the same commit");
    assert.equal(audit(organization.id, OWNER, T)[0].event, "organization.created");
    assert.equal(data(orgRun("ownOrganizations", { c: null }, OWNER, T)).length, 1);
    assert.deepEqual(data(orgRun("ownOrganizations", { c: null }, OUTSIDER, T)), []);

    const otherOrganization = written(orgRun("organizationCreate", { name: "Other Tenant" }, OTHER_OWNER, T + 1));
    denied("memberRoster", { organization: organization.id, c: null }, OTHER_OWNER, T + 1, "ORGANIZATION_MEMBER_REQUIRED");
    denied("organizationRecordInvitation", {
      id: id(1), organization: organization.id, recipientEmail: "tenant-cross@example.test", tokenHash: digest("tenant-cross"),
    }, OTHER_OWNER, T + 1, "ORGANIZATION_NOT_FOUND");
    denied("organizationSetCapacity", { organization: organization.id, seatLimit: 20 }, OWNER, T + 2, "ORGANIZATION_SERVICE_REQUIRED");
    assert.equal(written(orgRun("organizationSetCapacity", { organization: organization.id, seatLimit: 20 }, SERVICE, T + 2)).seatLimit, 20);

    const defaultToken = "default-lifetime-token";
    recordInvitation(id(2), organization.id, "recipient@example.test", defaultToken, OWNER, T + 10);
    const defaultInvite = findInvitation(organization.id, id(2), OWNER, T + 10);
    assert.equal(defaultInvite.expiresAt, T + 10 + 604_800_000, "default invitation lifetime is seven days");
    assert.ok(defaultInvite.reservation, "a pending invitation reserves one seat");
    written(orgRun("organizationRevokeInvitation", { invitation: id(2) }, OWNER, T + 11));
    const auditAfterFirstRevoke = audit(organization.id, OWNER, T + 11).filter(row => row.event === "invitation.revoked").length;
    written(orgRun("organizationRevokeInvitation", { invitation: id(2) }, OWNER, T + 12));
    assert.equal(audit(organization.id, OWNER, T + 12).filter(row => row.event === "invitation.revoked").length, auditAfterFirstRevoke, "re-revoke is a no-op");
    assert.equal(findInvitation(organization.id, id(2), OWNER, T + 12).reservation, null);
    const auditBeforeRevokedAccept = audit(organization.id, OWNER, T + 13).length;
    denied("organizationAcceptInvitation", { invitation: id(2), rawToken: defaultToken }, RECIPIENT, T + 13, "ORGANIZATION_INVITATION_NOT_PENDING");
    const revokedAfterAccept = findInvitation(organization.id, id(2), OWNER, T + 13);
    assert.equal(revokedAfterAccept.status, "revoked");
    assert.equal(revokedAfterAccept.reservation, null);
    assert.equal(audit(organization.id, OWNER, T + 13).length, auditBeforeRevokedAccept, "accepting a revoked invitation changes no audit state");

    written(orgRun("organizationSetPolicy", { invitationLifetimeMs: 10_000, defaultSeatLimit: 20 }, SERVICE, T + 20));
    assert.deepEqual(data(orgRun("organizationPolicy", {}, RECIPIENT, T + 20)), {
      invitationLifetimeMs: 10_000, defaultSeatLimit: 20,
    });
    const policyOrganization = written(orgRun("organizationCreate", { name: "Policy Default" }, OTHER_OWNER, T + 21));
    assert.equal(policyOrganization.seatLimit, 20, "service policy controls only new-organization defaults");
    denied("organizationRecordInvitation", {
      id: id(3), organization: organization.id, recipientEmail: " spaced@example.test", tokenHash: digest("space"),
    }, OWNER, T + 22, "ORGANIZATION_RECIPIENT_WHITESPACE");
    denied("organizationRecordInvitation", {
      id: id(4), organization: organization.id, recipientEmail: "case-hash@example.test", tokenHash: digest("hash").toUpperCase(),
    }, OWNER, T + 22, "ORGANIZATION_TOKEN_HASH");

    const adminToken = "admin-membership-token";
    recordInvitation(id(5), organization.id, "admin@example.test", adminToken, OWNER, T + 30);
    written(orgRun("organizationAcceptInvitation", { invitation: id(5), rawToken: adminToken }, ADMIN, T + 31));
    written(orgRun("organizationSetMemberRole", { organization: organization.id, principal: ADMIN, role: "admin" }, OWNER, T + 32));
    const memberToken = "ordinary-membership-token";
    recordInvitation(id(6), organization.id, "member@example.test", memberToken, ADMIN, T + 40);
    written(orgRun("organizationAcceptInvitation", { invitation: id(6), rawToken: memberToken }, MEMBER, T + 41));
    assert.equal(roster(organization.id, OWNER, T + 41).length, 3);
    assert.equal(roster(organization.id, ADMIN, T + 41).length, 3);
    assert.equal(roster(organization.id, MEMBER, T + 41).length, 3);
    assert.ok(invitations(organization.id, ADMIN, T + 41).length > 0, "an admin can read invitation history");
    assert.ok(audit(organization.id, ADMIN, T + 41).length > 0, "an admin can read organization audit history");
    denied("memberRoster", { organization: organization.id, c: null }, RECIPIENT, T + 41, "ORGANIZATION_MEMBER_REQUIRED");
    denied("memberRoster", { organization: organization.id, c: null }, OUTSIDER, T + 41, "ORGANIZATION_MEMBER_REQUIRED");
    denied("organizationRecordInvitation", {
      id: id(7), organization: organization.id, recipientEmail: "member-write@example.test", tokenHash: digest("member-write"),
    }, MEMBER, T + 42, "ORGANIZATION_ADMIN_REQUIRED");

    const alreadyToken = "already-admin-token";
    recordInvitation(id(8), organization.id, "admin@example.test", alreadyToken, OWNER, T + 50);
    const beforeAlready = roster(organization.id, OWNER, T + 50);
    written(orgRun("organizationAcceptInvitation", { invitation: id(8), rawToken: alreadyToken }, ADMIN, T + 51));
    const afterAlready = roster(organization.id, OWNER, T + 51);
    assert.equal(afterAlready.length, beforeAlready.length, "an existing member consumes an invitation without a duplicate seat");
    assert.equal(afterAlready.find(row => row.principal === ADMIN).role, "admin", "existing-member acceptance preserves role");
    denied("organizationAcceptInvitation", { invitation: id(8), rawToken: alreadyToken }, ADMIN, T + 52, "ORGANIZATION_INVITATION_NOT_PENDING");
    denied("organizationRevokeInvitation", { invitation: id(8) }, OWNER, T + 52, "ORGANIZATION_INVITATION_NOT_PENDING");

    const sharedToken = "same-email-token";
    recordInvitation(id(9), organization.id, "shared@example.test", sharedToken, OWNER, T + 60);
    assert.equal(data(orgRun("invitationMetadata", { invitation: id(9) }, SAME_B, T + 60)).recipientEmail, "shared@example.test");
    written(orgRun("organizationAcceptInvitation", { invitation: id(9), rawToken: sharedToken }, SAME_A, T + 61));
    assert.ok(roster(organization.id, OWNER, T + 61).some(row => row.principal === SAME_A));
    assert.ok(!roster(organization.id, OWNER, T + 61).some(row => row.principal === SAME_B), "equal source email never merges distinct principals");
    assert.deepEqual(data(orgRun("ownOrganizations", { c: null }, SAME_B, T + 61)), []);

    const recipientToken = "correct-recipient-token";
    recordInvitation(id(10), organization.id, "recipient@example.test", recipientToken, OWNER, T + 70);
    for (const principal of [MEMBER, OUTSIDER, OTHER_OWNER]) {
      denied("adminInvitations", { organization: organization.id, c: null }, principal, T + 70, "ORGANIZATION_ADMIN_REQUIRED");
      denied("adminAudit", { organization: organization.id, c: null }, principal, T + 70, "ORGANIZATION_ADMIN_REQUIRED");
    }
    denied("invitationMetadata", { invitation: id(10) }, WRONG_ACCOUNT, T + 70, "ORGANIZATION_INVITATION_NOT_FOUND");
    denied("invitePreview", { invitation: id(10), rawToken: "wrong-token" }, RECIPIENT, T + 71, "ORGANIZATION_INVITATION_TOKEN");
    denied("invitePreview", { invitation: id(10), rawToken: digest(recipientToken) }, RECIPIENT, T + 71, "ORGANIZATION_INVITATION_TOKEN");
    denied("organizationAcceptInvitation", { invitation: id(10), rawToken: recipientToken }, WRONG_ACCOUNT, T + 71, "ORGANIZATION_INVITATION_NOT_FOUND");
    const rosterBeforeWrongTokens = roster(organization.id, OWNER, T + 71).length;
    const auditBeforeWrongTokens = audit(organization.id, OWNER, T + 71).length;
    denied("organizationAcceptInvitation", { invitation: id(10), rawToken: "wrong-token" }, RECIPIENT, T + 71, "ORGANIZATION_INVITATION_TOKEN");
    denied("organizationAcceptInvitation", { invitation: id(10), rawToken: digest(recipientToken) }, RECIPIENT, T + 71, "ORGANIZATION_INVITATION_TOKEN");
    const afterWrongTokens = findInvitation(organization.id, id(10), OWNER, T + 71);
    assert.equal(afterWrongTokens.status, "pending");
    assert.ok(afterWrongTokens.reservation, "wrong-token acceptance keeps the reservation");
    assert.equal(roster(organization.id, OWNER, T + 71).length, rosterBeforeWrongTokens);
    assert.equal(audit(organization.id, OWNER, T + 71).length, auditBeforeWrongTokens);
    assert.equal(data(orgRun("invitePreview", { invitation: id(10), rawToken: recipientToken }, RECIPIENT, T + 72)).id, id(10));
    written(orgRun("organizationAcceptInvitation", { invitation: id(10), rawToken: recipientToken }, RECIPIENT, T + 73));
    assert.ok(roster(organization.id, OWNER, T + 73).some(row => row.principal === RECIPIENT));

    recordInvitation(id(22), organization.id, "admin-revoke@example.test", "admin-revoke-token", ADMIN, T + 80);
    written(orgRun("organizationRevokeInvitation", { invitation: id(22) }, ADMIN, T + 81));
    assert.equal(findInvitation(organization.id, id(22), OWNER, T + 81).status, "revoked", "an admin may revoke a pending invitation");

    written(orgRun("organizationSetPolicy", { invitationLifetimeMs: 1000, defaultSeatLimit: 20 }, SERVICE, T + 100));
    const expiringToken = "exact-expiry-token";
    recordInvitation(id(11), organization.id, "recipient@example.test", expiringToken, OWNER, T + 200);
    denied("organizationRecordInvitation", {
      id: id(12), organization: organization.id, recipientEmail: "recipient@example.test", tokenHash: digest("duplicate-reservation"),
    }, OWNER, T + 1199, "ORGANIZATION_RECIPIENT_RESERVED");
    assert.equal(data(orgRun("invitePreview", { invitation: id(11), rawToken: expiringToken }, RECIPIENT, T + 1199)).id, id(11));
    denied("invitePreview", { invitation: id(11), rawToken: expiringToken }, RECIPIENT, T + 1200, "ORGANIZATION_INVITATION_EXPIRED");
    denied("organizationAcceptInvitation", { invitation: id(11), rawToken: expiringToken }, RECIPIENT, T + 1200, "ORGANIZATION_INVITATION_EXPIRED");
    assert.equal(findInvitation(organization.id, id(11), OWNER, T + 1200).status, "pending", "expiry refusal does not consume the invitation");
    recordInvitation(id(13), organization.id, "recipient@example.test", "replacement-after-expiry", OWNER, T + 1200);
    assert.ok(findInvitation(organization.id, id(13), OWNER, T + 1200).reservation, "the expired reservation releases its exact email key");
    written(orgRun("organizationRevokeInvitation", { invitation: id(13) }, OWNER, T + 1201));
    written(orgRun("organizationSetPolicy", { invitationLifetimeMs: 10_000, defaultSeatLimit: 20 }, SERVICE, T + 1202));

    for (const [invitation, email, raw] of [
      [id(14), "false@example.test", "false-profile-token"],
      [id(15), "missing@example.test", "missing-profile-token"],
      [id(16), "case@example.test", "case-profile-token"],
      [id(17), "stale@example.test", "stale-profile-token"],
    ]) recordInvitation(invitation, organization.id, email, raw, OWNER, T + 1300);
    denied("invitationMetadata", { invitation: id(14) }, FALSE_PROFILE, T + 1301, "ORGANIZATION_INVITATION_NOT_FOUND");
    denied("invitationMetadata", { invitation: id(15) }, MISSING_PROFILE, T + 1301, "ORGANIZATION_INVITATION_NOT_FOUND");
    denied("invitationMetadata", { invitation: id(16) }, CASE_PROFILE, T + 1301, "ORGANIZATION_INVITATION_NOT_FOUND");
    denied("organizationAcceptInvitation", { invitation: id(14), rawToken: "false-profile-token" }, FALSE_PROFILE, T + 1301, "ORGANIZATION_INVITATION_NOT_FOUND");
    denied("organizationAcceptInvitation", { invitation: id(15), rawToken: "missing-profile-token" }, MISSING_PROFILE, T + 1301, "ORGANIZATION_INVITATION_NOT_FOUND");
    denied("organizationAcceptInvitation", { invitation: id(16), rawToken: "case-profile-token" }, CASE_PROFILE, T + 1301, "ORGANIZATION_INVITATION_NOT_FOUND");
    const staleMetadata = data(orgRun("invitationMetadata", { invitation: id(17) }, STALE_PROFILE, T + 1301));
    assert.equal(staleMetadata.recipientEmail, "stale@example.test", "a stale but still verified exact profile satisfies only the metadata read rule");
    assert.ok(staleMetadata.reservation, "the same documented metadata limitation applies to the reservation");
    denied("invitePreview", { invitation: id(17), rawToken: "stale-profile-token" }, STALE_PROFILE, T + 1301, "ORGANIZATION_PROFILE_STALE");
    denied("organizationAcceptInvitation", { invitation: id(17), rawToken: "stale-profile-token" }, STALE_PROFILE, T + 1301, "ORGANIZATION_PROFILE_STALE");

    const boundaryToken = "proof-boundary-token";
    recordInvitation(id(18), organization.id, "boundary@example.test", boundaryToken, OWNER, T + 4500);
    assert.equal(data(orgRun("invitePreview", { invitation: id(18), rawToken: boundaryToken }, BOUNDARY_PROFILE, T + 4999)).id, id(18));
    denied("invitePreview", { invitation: id(18), rawToken: boundaryToken }, BOUNDARY_PROFILE, T + 5000, "ORGANIZATION_PROFILE_STALE");
    denied("organizationAcceptInvitation", { invitation: id(18), rawToken: boundaryToken }, BOUNDARY_PROFILE, T + 5000, "ORGANIZATION_PROFILE_STALE");
    const boundaryAfter = findInvitation(organization.id, id(18), OWNER, T + 5000);
    assert.equal(boundaryAfter.status, "pending");
    assert.ok(boundaryAfter.reservation, "proof-boundary refusal keeps the reservation");

    let currentRoster = roster(organization.id, OWNER, T + 5100);
    let currentInvitations = invitations(organization.id, OWNER, T + 5100);
    let liveReservations = currentInvitations.filter(row => row.reservation !== null).length;
    written(orgRun("organizationSetCapacity", {
      organization: organization.id, seatLimit: currentRoster.length + liveReservations,
    }, SERVICE, T + 5100));
    denied("organizationRecordInvitation", {
      id: id(19), organization: organization.id, recipientEmail: "capacity-denied@example.test", tokenHash: digest("capacity-denied"),
    }, OWNER, T + 5101, "ORGANIZATION_CAPACITY");

    written(orgRun("organizationSetCapacity", {
      organization: organization.id, seatLimit: currentRoster.length + liveReservations + 1,
    }, SERVICE, T + 5110));
    const lateToken = "late-capacity-token";
    recordInvitation(id(20), organization.id, "late@example.test", lateToken, OWNER, T + 5111);
    currentRoster = roster(organization.id, OWNER, T + 5111);
    const auditBeforeLate = audit(organization.id, OWNER, T + 5111).length;
    written(orgRun("organizationSetCapacity", {
      organization: organization.id, seatLimit: currentRoster.length,
    }, SERVICE, T + 5112));
    const auditAfterCapacityReduction = audit(organization.id, OWNER, T + 5112).length;
    assert.equal(auditAfterCapacityReduction, auditBeforeLate + 1);
    denied("organizationAcceptInvitation", { invitation: id(20), rawToken: lateToken }, LATE_PROFILE, T + 5113, "ORGANIZATION_CAPACITY");
    assert.equal(roster(organization.id, OWNER, T + 5113).length, currentRoster.length, "failed late admission rolls back the tentative member");
    const lateAfter = findInvitation(organization.id, id(20), OWNER, T + 5113);
    assert.equal(lateAfter.status, "pending", "failed late admission rolls back invitation consumption");
    assert.ok(lateAfter.reservation, "failed late admission restores the reservation");
    assert.equal(audit(organization.id, OWNER, T + 5113).length, auditAfterCapacityReduction, "failed late admission rolls back its audit row");
    written(orgRun("organizationSetCapacity", { organization: organization.id, seatLimit: 20 }, SERVICE, T + 5120));

    denied("organizationSetMemberRole", {
      organization: organization.id, principal: OWNER, role: "member",
    }, OWNER, T + 6000, "ORGANIZATION_OWNER_IMMUTABLE");
    denied("organizationLeave", { organization: organization.id }, OWNER, T + 6000, "ORGANIZATION_OWNER_IMMUTABLE");
    denied("organizationRemoveMember", {
      organization: organization.id, principal: OWNER,
    }, ADMIN, T + 6000, "ORGANIZATION_OWNER_IMMUTABLE");
    written(orgRun("organizationSetMemberRole", {
      organization: organization.id, principal: RECIPIENT, role: "admin",
    }, OWNER, T + 6000));
    denied("organizationRemoveMember", {
      organization: organization.id, principal: RECIPIENT,
    }, ADMIN, T + 6000, "ORGANIZATION_ADMIN_PEER");
    written(orgRun("organizationRemoveMember", {
      organization: organization.id, principal: RECIPIENT,
    }, OWNER, T + 6000));
    assert.ok(!roster(organization.id, OWNER, T + 6000).some(row => row.principal === RECIPIENT), "the owner may remove a non-owner admin");

    const beforeRemoval = roster(organization.id, OWNER, T + 6001).length;
    written(orgRun("organizationRemoveMember", { organization: organization.id, principal: MEMBER }, ADMIN, T + 6001));
    assert.equal(roster(organization.id, OWNER, T + 6001).length, beforeRemoval - 1);
    assert.deepEqual(data(orgRun("ownOrganizations", { c: null }, MEMBER, T + 6001)), []);
    denied("memberRoster", { organization: organization.id, c: null }, MEMBER, T + 6001, "ORGANIZATION_MEMBER_REQUIRED");

    const beforeLeave = roster(organization.id, OWNER, T + 6002).length;
    written(orgRun("organizationLeave", { organization: organization.id }, SAME_A, T + 6002));
    assert.equal(roster(organization.id, OWNER, T + 6002).length, beforeLeave - 1);
    assert.deepEqual(data(orgRun("ownOrganizations", { c: null }, SAME_A, T + 6002)), []);

    written(orgRun("organizationSetMemberRole", {
      organization: organization.id, principal: ADMIN, role: "member",
    }, OWNER, T + 6003));
    assert.equal(roster(organization.id, OWNER, T + 6003).find(row => row.principal === ADMIN).role, "member");
    denied("organizationRecordInvitation", {
      id: id(21), organization: organization.id, recipientEmail: "former-admin@example.test", tokenHash: digest("former-admin"),
    }, ADMIN, T + 6003, "ORGANIZATION_ADMIN_REQUIRED");
    written(orgRun("organizationLeave", { organization: organization.id }, ADMIN, T + 6004));
    assert.ok(!roster(organization.id, OWNER, T + 6004).some(row => row.principal === ADMIN));

    const finalAudit = audit(organization.id, OWNER, T + 6004);
    for (const event of [
      "organization.created", "invitation.recorded", "invitation.accepted", "invitation.revoked",
      "member.role", "member.removed", "member.left", "capacity.set",
    ]) assert.ok(finalAudit.some(row => row.event === event), `audit retains ${event}`);
    for (const row of finalAudit) {
      assert.ok(!Object.hasOwn(row, "tokenHash") && !Object.hasOwn(row, "rawToken"), "audit rows contain neither token nor digest");
    }
    for (const row of invitations(organization.id, OWNER, T + 6004)) {
      assert.ok(!Object.hasOwn(row, "tokenHash") && !Object.hasOwn(row, "rawToken"), "ordinary invitation reads expose neither token nor digest");
    }
    assert.equal(roster(otherOrganization.id, OTHER_OWNER, T + 6004).length, 1, "other-tenant membership remains isolated");

    assert.deepEqual(refusalProblems, [], `policy refusal envelope/code mismatches; private responses preserved at ${responseJournal}`);
    complete = true;
  } finally {
    const cleanupRelative = relative(parent, canonical);
    const cleanupContained = cleanupRelative.length > 0 && cleanupRelative !== ".."
      && !cleanupRelative.startsWith(`..${sep}`) && !isAbsolute(cleanupRelative);
    assert.ok(cleanupContained, "refusing cleanup outside the canonical scratch parent");
    if (complete) rmSync(canonical, { recursive: true, force: true });
    else process.stderr.write(`managed-policy scratch preserved after failure: ${canonical}\n`);
  }
});
