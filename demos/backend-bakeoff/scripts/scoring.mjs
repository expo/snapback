#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const bakeoffRoot = path.resolve(here, "..");
const providerIds = ["snapback", "convex", "supabase", "firebase", "instantdb", "spacetimedb", "appwrite"];
const appIds = ["todo", "chat", "linear", "partiful", "research-room"];

// @ref LLP 0102#4-holistic-composite — freeze equal app weighting,
// ineligibility, practical ties, and one-weight-at-a-time sensitivity before
// any subjective outcome is visible.
function rounded(value) {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

export function validateRatings(input, scoring) {
  const problems = [];
  if (input?.schemaVersion !== 1) problems.push("schemaVersion must be 1");
  const categories = Object.keys(scoring.categories);
  for (const [provider, appRatings] of Object.entries(input?.ratings ?? {})) {
    if (!providerIds.includes(provider)) problems.push(`${provider}: unknown provider`);
    for (const [app, rating] of Object.entries(appRatings ?? {})) {
      if (!appIds.includes(app)) problems.push(`${provider}/${app}: unknown app`);
      const actual = Object.keys(rating?.categories ?? {}).sort();
      if (JSON.stringify(actual) !== JSON.stringify([...categories].sort())) {
        problems.push(`${provider}/${app}: category set does not match frozen scoring categories`);
      }
      for (const [category, value] of Object.entries(rating?.categories ?? {})) {
        if (!Number.isFinite(value) || value < 0 || value > 5) {
          problems.push(`${provider}/${app}/${category}: rating must be between 0 and 5`);
        }
      }
      if (!Array.isArray(rating?.evidence) || rating.evidence.length === 0) {
        problems.push(`${provider}/${app}: at least one evidence path is required`);
      }
    }
  }
  return problems;
}

function providerResult(provider, appRatings, weights) {
  const missingApps = appIds.filter((app) => !appRatings?.[app]);
  const categoryMeans = {};
  for (const category of Object.keys(weights)) {
    const values = appIds
      .map((app) => appRatings?.[app]?.categories?.[category])
      .filter(Number.isFinite);
    categoryMeans[category] = values.length === 0
      ? null
      : rounded(values.reduce((sum, value) => sum + value, 0) / values.length);
  }
  const score = missingApps.length > 0
    ? null
    : rounded(Object.entries(weights).reduce(
      (sum, [category, weight]) => sum + (categoryMeans[category] / 5) * weight,
      0,
    ));
  const stopDefects = appIds.flatMap((app) =>
    (appRatings?.[app]?.stopDefects ?? []).map((defect) => ({ app, defect })));
  return {
    provider,
    eligibleForTotalOrdering: missingApps.length === 0,
    missingApps,
    categoryMeans,
    composite: score,
    stopDefects,
  };
}

function ranked(results) {
  return results
    .filter((result) => result.eligibleForTotalOrdering)
    .sort((left, right) => right.composite - left.composite || left.provider.localeCompare(right.provider))
    .map((result, index) => ({
      rank: index + 1,
      provider: result.provider,
      composite: result.composite,
      stopDefects: result.stopDefects,
    }));
}

function normalizeWeights(weights) {
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(Object.entries(weights).map(([category, value]) => [category, value * 100 / total]));
}

export function scoreBakeoff(input, scoring) {
  const problems = validateRatings(input, scoring);
  if (problems.length > 0) {
    const error = new Error("invalid scoring input");
    error.problems = problems;
    throw error;
  }
  const baseWeights = scoring.categories;
  const providers = providerIds.map((provider) => providerResult(provider, input.ratings?.[provider], baseWeights));
  const ranking = ranked(providers);
  const basePositions = Object.fromEntries(ranking.map((item) => [item.provider, item.rank]));
  const sensitivity = [];
  for (const category of Object.keys(baseWeights)) {
    for (const factor of [0.75, 1.25]) {
      const raw = { ...baseWeights, [category]: baseWeights[category] * factor };
      const weights = normalizeWeights(raw);
      const caseResults = providerIds.map((provider) => providerResult(provider, input.ratings?.[provider], weights));
      const caseRanking = ranked(caseResults);
      sensitivity.push({
        category,
        variationPercent: factor === 0.75 ? -25 : 25,
        weights: Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, rounded(value)])),
        ranking: caseRanking,
        rankChanges: caseRanking
          .filter((item) => basePositions[item.provider] !== item.rank)
          .map((item) => ({
            provider: item.provider,
            from: basePositions[item.provider],
            to: item.rank,
          })),
      });
    }
  }
  const practicalTies = [];
  for (let left = 0; left < ranking.length; left += 1) {
    for (let right = left + 1; right < ranking.length; right += 1) {
      const difference = rounded(Math.abs(ranking[left].composite - ranking[right].composite));
      if (difference <= scoring.scale.practicalTiePoints) {
        practicalTies.push({
          providers: [ranking[left].provider, ranking[right].provider],
          difference,
        });
      }
    }
  }
  return {
    schemaVersion: 1,
    scale: "0-100",
    providers,
    ranking,
    practicalTies,
    sensitivity,
    weightSensitive: sensitivity.some((item) => item.rankChanges.length > 0),
    architecturalPotentialIncluded: false,
  };
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error("usage: node scripts/scoring.mjs <ratings.json>");
  const [input, scoring] = await Promise.all([
    readFile(path.resolve(process.cwd(), inputPath), "utf8").then(JSON.parse),
    readFile(path.join(bakeoffRoot, "protocol", "scoring.v1.json"), "utf8").then(JSON.parse),
  ]);
  console.log(JSON.stringify(scoreBakeoff(input, scoring), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message, problems: error.problems ?? [] }, null, 2));
    process.exitCode = 1;
  });
}
