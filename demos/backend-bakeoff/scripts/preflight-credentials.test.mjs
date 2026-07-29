import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyAppwrite,
  classifyFirebase,
  classifyInstant,
  classifySpacetime,
  classifySupabase,
  parseDogfoodTargetCapabilities,
  parseLocalPreflight,
  probeDogfoodTargets,
} from "./preflight-credentials.mjs";

test("credential classifiers recognize missing sessions without retaining values", () => {
  assert.equal(classifyFirebase("No authorized accounts", 0), "missing");
  assert.equal(classifyInstant("You are not logged in", 0), "missing");
  assert.equal(classifySpacetime("No current login", 1), "missing");
  assert.equal(classifySupabase("Access token required", 1), "missing");
  assert.equal(classifyAppwrite("unauthorized", 1), "missing");
});

test("credential classifiers recognize successful provider shapes", () => {
  assert.equal(classifyFirebase("Authorized account: builder@example.test", 0), "ready");
  assert.equal(classifyInstant("Logged in", 0), "ready");
  assert.equal(classifySpacetime("Identity: redacted", 0), "ready");
  assert.equal(classifySupabase("[]", 0), "ready");
  assert.equal(classifyAppwrite("{}", 0), "ready");
});

test("ambiguous successful output is not promoted to ready", () => {
  assert.equal(classifyFirebase('{"status":"success"}', 0), "indeterminate");
  assert.equal(classifyInstant("Instant CLI 1.0", 0), "indeterminate");
  assert.equal(classifySpacetime("CLI 2.7.0", 0), "indeterminate");
  assert.equal(classifySupabase("ok", 0), "indeterminate");
});

test("local preflight reads capability booleans without returning values", () => {
  const parsed = parseLocalPreflight(`
## Backend bakeoff
- BAKEOFF_ALICE_EMAIL: alice@example.test
- BAKEOFF_BOB_EMAIL: bob@example.test
- BAKEOFF_MALLORY_EMAIL: mallory@example.test
- BAKEOFF_PAID_PLANS_APPROVED: approved
`);
  assert.deepEqual(parsed, {
    aliceMailboxConfigured: true,
    bobMailboxConfigured: true,
    malloryMailboxConfigured: true,
    paidPlanApprovalRecorded: true,
  });
  assert.equal(JSON.stringify(parsed).includes("example.test"), false);
});

test("dogfood secrets expose only shared-target capability booleans", () => {
  const parsed = parseDogfoodTargetCapabilities(`
SUPABASE_URL=...
SUPABASE_URL: https://example.invalid
SUPABASE_PUBLISHABLE_KEY: publishable-value
SUPABASE_SECRET_KEY: secret-value
CONVEX_DEPLOY_KEY: deployment-value
CONVEX_URL: https://example.invalid
Public App ID:
instant-app-value
Admin token:
instant-admin-value
`);
  assert.deepEqual(parsed, {
    supabaseSharedTarget: true,
    convexSharedTarget: true,
    instantdbSharedTarget: true,
  });
  assert.equal(JSON.stringify(parsed).includes("deployment-value"), false);
  assert.equal(JSON.stringify(parsed).includes("instant-admin-value"), false);
});

test("dogfood parser rejects placeholders and prose containing credential labels", () => {
  const parsed = parseDogfoodTargetCapabilities(`
Use SUPABASE_URL and SUPABASE_SECRET_KEY from the dashboard.
SUPABASE_URL=...
SUPABASE_ANON_KEY=<replace-me>
SUPABASE_SECRET_KEY=REDACTED

CONVEX_DEPLOY_KEY=TODO
CONVEX_URL:
Public App ID:
Admin token:
`);
  assert.deepEqual(parsed, {
    supabaseSharedTarget: false,
    convexSharedTarget: false,
    instantdbSharedTarget: false,
  });
});

test("dogfood parser accepts exact next-line InstantDB values only", () => {
  const parsed = parseDogfoodTargetCapabilities(`
Public App ID:
\`instant-app-value\`
Admin token:
'instant-admin-value'
`);
  assert.equal(parsed.instantdbSharedTarget, true);
});

test("shared-target probe returns statuses without credential values", async () => {
  const parsed = await probeDogfoodTargets(
    `
SUPABASE_URL: https://example.invalid
SUPABASE_PUBLISHABLE_KEY: publishable-value
CONVEX_DEPLOY_KEY:
CONVEX_URL:
Public App ID:
Admin token:
`,
    async (url, options) => {
      assert.equal(url, "https://example.invalid/auth/v1/health");
      assert.equal(options.headers.apikey, "publishable-value");
      return { ok: true };
    },
  );
  assert.deepEqual(parsed.targets, {
    supabase: "reachable-read-only",
    convex: "missing",
    instantdb: "missing",
  });
  assert.equal(JSON.stringify(parsed).includes("publishable-value"), false);
  assert.equal(parsed.eligibility, "eligible-with-arm-namespace-and-baseline-preserving-cleanup");
});
