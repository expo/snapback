// Extracts each submission's code block and machine-checks TS arms through
// the real compiler+checker. Writes grading/modules/*.{ts,q} and
// grading/machine-results.json.
// Usage: node grade.mjs   (run from anywhere; bun must be on PATH)
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const runsDir = join(here, "runs");
const outDir = join(here, "grading", "modules");
mkdirSync(outDir, { recursive: true });
const compilerDir = join(here, "..", "..", "snapback2", "packages", "compiler");

function largestBlock(text) {
  const blocks = [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  if (blocks.length === 0) return null;
  return blocks.reduce((a, b) => (b.length > a.length ? b : a));
}

const results = [];
for (const model of readdirSync(runsDir)) {
  const dir = join(runsDir, model);
  for (const file of readdirSync(dir).filter((f) => /^[ABC]-T\d\d\.md$/.test(f))) {
    const name = basename(file, ".md");
    const arm = name[0];
    const raw = readFileSync(join(dir, file), "utf8");
    const block = largestBlock(raw);
    const rec = {
      model,
      arm,
      task: name.slice(2),
      outputBytes: raw.length,
      blockBytes: block ? block.length : 0,
      extracted: block !== null,
      machine: null,
    };
    if (block) {
      const ext = arm === "C" ? "q" : "ts";
      const modPath = join(outDir, `${model}-${name}.${ext}`);
      writeFileSync(modPath, block);
      if (ext === "ts") {
        let stdout;
        try {
          stdout = execFileSync("bun", ["src/cli.ts", modPath, "--synthetic-schema"], {
            cwd: compilerDir,
            encoding: "utf8",
            maxBuffer: 16 * 1024 * 1024,
          });
        } catch (e) {
          stdout = (e.stdout || "") + "";
          if (!stdout.trim()) {
            rec.machine = { ok: false, families: ["E_HARNESS"], detail: String(e.message).slice(0, 300) };
          }
        }
        if (stdout && stdout.trim() && rec.machine === null) {
          try {
            const parsed = JSON.parse(stdout);
            if (parsed.ok === false) {
              const diags = parsed.diagnostics ?? [];
              rec.machine = {
                ok: false,
                families: [...new Set(diags.map((d) => d.family ?? "E_LOWERING"))],
                detail: diags.map((d) => d.message).join(" | ").slice(0, 300),
              };
            } else {
              const errs = (parsed.checked ?? []).filter((c) => c.error);
              rec.machine = {
                ok: errs.length === 0,
                families: [...new Set(errs.map((c) => c.error.family))],
                detail: errs.map((c) => c.error.message).join(" | ").slice(0, 300),
                programs: (parsed.checked ?? []).length,
              };
            }
          } catch {
            rec.machine = { ok: false, families: ["E_HARNESS_PARSE"], detail: stdout.slice(0, 200) };
          }
        }
      }
    }
    results.push(rec);
  }
}

results.sort((a, b) => a.task.localeCompare(b.task) || a.arm.localeCompare(b.arm) || a.model.localeCompare(b.model));
writeFileSync(join(here, "grading", "machine-results.json"), JSON.stringify(results, null, 2));

let ok = 0, bad = 0;
for (const r of results) if (r.machine) r.machine.ok ? ok++ : bad++;
console.log(`${results.length} submissions; TS machine-checked: ${ok} pass, ${bad} refused`);
for (const r of results.filter((r) => r.machine && !r.machine.ok)) {
  console.log(`  ${r.model} ${r.arm}-${r.task}: ${r.machine.families.join(",")} — ${r.machine.detail.slice(0, 100)}`);
}
