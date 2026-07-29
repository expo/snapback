import test from "node:test";
import assert from "node:assert/strict";
import { scoreBakeoff, validateRatings } from "./scoring.mjs";

const scoring = {
  scale: { practicalTiePoints: 3 },
  categories: {
    authoring: 15,
    modeling: 10,
    correctness: 10,
    realtimeOffline: 12,
    auth: 8,
    completeness: 10,
    deploymentOperations: 12,
    testingDocsAgent: 8,
    performanceCost: 7,
    maturityControl: 8,
  },
};
const apps = ["todo", "chat", "linear", "partiful", "research-room"];
const providers = ["snapback", "convex", "supabase", "firebase", "instantdb", "spacetimedb", "appwrite"];

function rating(value) {
  return {
    categories: Object.fromEntries(Object.keys(scoring.categories).map((category) => [category, value])),
    evidence: ["diary.md"],
    stopDefects: [],
  };
}

function completeInput() {
  return {
    schemaVersion: 1,
    ratings: Object.fromEntries(providers.map((provider, providerIndex) => [
      provider,
      Object.fromEntries(apps.map((app) => [app, rating(5 - providerIndex * 0.5)])),
    ])),
  };
}

test("maps five exceptional app ratings to 100", () => {
  const result = scoreBakeoff(completeInput(), scoring);
  assert.equal(result.providers.find((item) => item.provider === "snapback").composite, 100);
  assert.equal(result.ranking[0].provider, "snapback");
  assert.equal(result.sensitivity.length, 20);
  assert.ok(result.sensitivity.every((item) =>
    Math.abs(Object.values(item.weights).reduce((sum, value) => sum + value, 0) - 100) < 0.001));
});

test("an unattempted app makes a provider ineligible rather than scoring it zero", () => {
  const input = completeInput();
  delete input.ratings.convex["research-room"];
  const result = scoreBakeoff(input, scoring);
  const convex = result.providers.find((item) => item.provider === "convex");
  assert.equal(convex.eligibleForTotalOrdering, false);
  assert.equal(convex.composite, null);
  assert.deepEqual(convex.missingApps, ["research-room"]);
  assert.equal(result.ranking.some((item) => item.provider === "convex"), false);
});

test("ratings require the exact category set and evidence", () => {
  const input = completeInput();
  delete input.ratings.firebase.todo.categories.auth;
  input.ratings.appwrite.chat.evidence = [];
  const problems = validateRatings(input, scoring);
  assert.ok(problems.some((problem) => problem.includes("category set")));
  assert.ok(problems.some((problem) => problem.includes("evidence path")));
});

test("scores within three points are reported as practical ties", () => {
  const input = completeInput();
  for (const app of apps) input.ratings.convex[app] = rating(4.9);
  const result = scoreBakeoff(input, scoring);
  assert.ok(result.practicalTies.some((tie) =>
    tie.providers.includes("snapback") && tie.providers.includes("convex") && tie.difference === 2));
});
