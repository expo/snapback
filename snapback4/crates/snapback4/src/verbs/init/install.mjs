// Keep slow dependency resolution visible, including when npm has no output.
import { spawn } from "node:child_process";
const began = Date.now();
console.error("Installing dependencies with npm; package-manager output follows.");
const child = spawn("npm", ["install", ...process.argv.slice(2)], { stdio: "inherit" });
const progress = setInterval(() => console.error(`npm install still running (${Math.round((Date.now() - began) / 1000)}s elapsed)`), 10_000);
child.once("error", error => { clearInterval(progress); console.error(`npm install could not start: ${error.message}`); process.exitCode = 1; });
child.once("exit", (code, signal) => { clearInterval(progress); console.error(`npm install finished (${Math.round((Date.now() - began) / 1000)}s${signal ? `, ${signal}` : ""})`); process.exitCode = code ?? 1; });
