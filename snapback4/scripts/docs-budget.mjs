// W14b revision 2 §6: count physical lines and require the in-file first-screen path.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const budget = JSON.parse(readFileSync(new URL("metrics/docs-budget.json", root), "utf8"));
const readme = readFileSync(new URL("packages/snapback4/README.md", root), "utf8");
const actual = (readme.match(/\n/g)?.length ?? 0) + Number(readme.length > 0 && !readme.endsWith("\n"));
const valid = Number.isSafeInteger(budget.readmeLines) && budget.readmeLines > 0 &&
  typeof budget.set === "string" && budget.set.length > 0 && typeof budget.why === "string" && budget.why.length > 0;
console.log(`docs budget: README ${actual}/${budget.readmeLines} physical lines`);
if (!valid) console.error("docs budget: expected a positive readmeLines budget, set date and reason");
if (actual > budget.readmeLines) console.error("docs budget: README exceeds its budget; preserve the first-screen path when editing");
// Run even after a size failure: the suite reports both failures, and size alone cannot qualify the orientation.
const sufficient = spawnSync("cargo", ["test", "-p", "snapback4-lang", "--test", "guide", "w14b_first_account_screen_is_self_contained", "--", "--exact"],
  { cwd: fileURLToPath(root), encoding: "utf8" });
process.stdout.write(sufficient.stdout ?? "");
process.stderr.write(sufficient.stderr ?? "");
const ran = /test result: ok\. 1 passed; 0 failed;/.test(sufficient.stdout ?? "");
if (sufficient.status === 0 && !ran) console.error("docs budget: the named self-containment test must run exactly once");
if (sufficient.error) console.error(`docs budget: self-containment test could not run: ${sufficient.error.message}`);
process.exitCode = valid && actual <= budget.readmeLines && sufficient.status === 0 && ran ? 0 : 1;
