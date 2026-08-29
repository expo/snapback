import { lowerSource, typecheckSource } from "./compiler";
import { assessGauntlet } from "./gauntlet";
import type { Program } from "./ir";
import { rustCheck } from "./rust-check";

const frontend = decodeURIComponent(new URL("../", import.meta.url).pathname);
const crate = decodeURIComponent(new URL("../../../", import.meta.url).pathname);
const repo = decodeURIComponent(new URL("../../../../", import.meta.url).pathname);
const libText = await Bun.file(`${frontend}lib.d.ts`).text();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function canonical(value: unknown): string {
  const normalize = (item: any): any => Array.isArray(item)
    ? item.map(normalize)
    : item && typeof item === "object"
      ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, normalize(item[key])]))
      : item;
  return JSON.stringify(normalize(value));
}

const s1Source = await Bun.file(`${frontend}fixtures/s1/programs.ts`).text();
const s1 = lowerSource(s1Source, "fixtures/s1/programs.ts", libText);
assert(s1.ok, `S1 source refused: ${s1.ok ? "" : s1.diagnostics[0]?.message}`);
assert(s1.programs.length === 17, `expected 17 S1 programs, got ${s1.programs.length}`);

const corpusFiles = [
  "named-thread",
  "named-send",
  "named-send-maintained-unread",
  "named-mark-read",
  "named-inbox-count-capped",
  "named-inbox-maintained",
  "named-start-dm",
  "named-board-view",
  "named-board-summary",
  "named-ledger",
  "named-add-expense",
  "named-ancestors",
  "named-mention-scan",
  "named-helper-wrapped-scan",
  "named-maintained-waitlist",
  "named-hidden-rule",
  "named-delete-message",
];
const referencePrograms: Program[] = [];
for (const file of corpusFiles) {
  const fixture = await Bun.file(`${crate}corpus/${file}.json`).json();
  referencePrograms.push(fixture.program as Program);
}
const references = new Map(referencePrograms.map((program) => [program.name, program]));
for (const program of s1.programs) {
  assert(canonical(program) === canonical(references.get(program.name)), `${program.name} IR differs from S1`);
}
const candidateCertificates = rustCheck(s1.programs, "spike");
const referenceCertificates = new Map(rustCheck(referencePrograms, "spike").map((item) => [item.program, item]));
for (const candidate of candidateCertificates) {
  assert(candidate.error === null, `${candidate.program} candidate did not certify`);
  const reference = referenceCertificates.get(candidate.program);
  assert(reference?.error === null, `${candidate.program} reference did not certify`);
  assert(
    canonical(candidate.certificate) === canonical(reference.certificate),
    `${candidate.program} certificate differs from S1`,
  );
}

const firstAttempts: Record<string, string> = {
  "unbound-scan.ts": "E_UNBOUND_SCAN",
  "unbound-count.ts": "E_UNBOUND_COUNT",
  "structural-loop-tally.ts": "E_STRUCTURAL_COUNT",
  "ambient-time.ts": "E_AMBIENT_TIME",
  "while-loop.ts": "E_OPAQUE",
  "structural-rank.ts": "E_STRUCTURAL_COUNT",
  "helper-scan.ts": "E_UNBOUND_SCAN",
  "split-loop.ts": "E_UNBOUND_LOOP",
};
const families = new Set<string>();
for (const [file, expected] of Object.entries(firstAttempts)) {
  const source = await Bun.file(`${frontend}fixtures/first-attempts/${file}`).text();
  const refused = lowerSource(source, file, libText);
  assert(!refused.ok, `${file} unexpectedly lowered`);
  const item = refused.diagnostics[0]!;
  assert(item.family === expected, `${file}: expected ${expected}, got ${item.family}`);
  assert(item.span.line > 0 && item.span.column > 0 && item.span.end > item.span.start, `${file}: invalid span`);
  assert(item.rewrite !== source, `${file}: rewrite did not change source`);
  const fixed = lowerSource(item.rewrite, `fixed-${file}`, libText);
  assert(fixed.ok, `${file}: verbatim rewrite did not lower`);
  assert(rustCheck(fixed.programs, "synthetic").every((result) => result.error === null), `${file}: rewrite did not certify`);
  families.add(item.family);
}

const boundSource = await Bun.file(`${frontend}fixtures/bound.ts`).text();
const bound = lowerSource(boundSource, "bound.ts", libText);
assert(!bound.ok && bound.diagnostics[0]?.family === "E_BOUND", "bound fixture did not emit E_BOUND");
const boundFixed = lowerSource(bound.diagnostics[0]!.rewrite, "fixed-bound.ts", libText);
assert(boundFixed.ok, "E_BOUND rewrite did not lower");
assert(rustCheck(boundFixed.programs, "synthetic").every((result) => result.error === null), "E_BOUND rewrite did not certify");
families.add("E_BOUND");
assert(
  canonical([...families].sort()) === canonical([
    "E_AMBIENT_TIME",
    "E_BOUND",
    "E_OPAQUE",
    "E_STRUCTURAL_COUNT",
    "E_UNBOUND_COUNT",
    "E_UNBOUND_LOOP",
    "E_UNBOUND_SCAN",
  ]),
  "diagnostic catalogue was not fully exercised",
);

for (const forbidden of ["Date.now()", "Math.random()", "fetch('x')", "setTimeout(() => 0, 1)", "eval('1')"]) {
  assert(typecheckSource(`const value = ${forbidden};`, "forbidden.ts", libText).length > 0, `${forbidden} exists in lib.d.ts`);
}

const subsetSource = await Bun.file(`${frontend}fixtures/subset-surface.ts`).text();
const subset = lowerSource(subsetSource, "fixtures/subset-surface.ts", libText);
assert(subset.ok, `admitted collection/write-callback surface refused: ${subset.ok ? "" : subset.diagnostics[0]?.message}`);
assert(subset.programs.length === 3, `expected three subset-surface programs, got ${subset.programs.length}`);
assert(
  rustCheck(subset.programs, "synthetic").every((result) => result.error === null),
  "collection/write-callback surface did not certify",
);

const gauntletLib = `${libText}\n${await Bun.file(`${frontend}gauntlet.d.ts`).text()}`;
const codexReview = await Bun.file(`${repo}llp/reviews/0329.014-bounded-data-programs.codex.r3.md`).text();
const fableReview = await Bun.file(`${repo}llp/reviews/0329.014-bounded-data-programs.fable.r3.md`).text();
const gauntlet = [
  ...assessGauntlet("codex", codexReview, gauntletLib),
  ...assessGauntlet("fable", fableReview, gauntletLib),
];
assert(gauntlet.length === 30, `expected 30 numbered gauntlet shapes, got ${gauntlet.length}`);
const coded = gauntlet.filter((item) => item.source.trim());
const unchanged = gauntlet.filter((item) => item.disposition === "unchanged").length;
const mechanical = gauntlet.filter((item) => item.disposition === "mechanical").length;
const refused = gauntlet.filter((item) => item.disposition === "refused").length;
const qualifying = coded.filter((item) => item.disposition !== "refused").length;
assert(coded.length === 27, `expected 27 shapes with code, got ${coded.length}`);
const hazardPass = qualifying >= Math.ceil(coded.length * 0.7);

console.log(
  JSON.stringify({
    s1Programs: s1.programs.length,
    certificateIdentical: candidateCertificates.length,
    firstAttemptRewrites: Object.keys(firstAttempts).length,
    subsetSurfacePrograms: subset.programs.length,
    diagnostics: [...families].sort(),
    gauntlet: { totalShapes: 30, codeShapes: coded.length, unchanged, mechanical, refused, qualifying, hazardPass },
  }),
);
