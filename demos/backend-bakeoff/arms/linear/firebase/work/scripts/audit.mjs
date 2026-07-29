import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

async function audit(cwd, destination) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn("npm", ["audit", "--json"], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (exitStatus) => resolve({ exitStatus: exitStatus ?? 1, stdout, stderr }));
  });
  await writeFile(destination, result.stdout || JSON.stringify({ stderr: result.stderr }));
  return {
    cwd,
    destination,
    exitStatus: result.exitStatus,
    nonzeroMeansVulnerabilitiesReported: true,
  };
}

const results = [
  await audit(process.cwd(), "receipts/npm-audit.json"),
  await audit(`${process.cwd()}/functions`, "receipts/functions-npm-audit.json"),
];
console.log(JSON.stringify(results, null, 2));
