// API signatures: snapback4 guide api proof
import { serveCheck } from "snapback4/proof";
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--then" || !args[1].trim())) throw Error("usage: npm run prod:check -- [--then '<command>']");
const report = await serveCheck({ script: "prod:serve", deployment: process.env.SNAPBACK4_PROD_DIRECTORY ?? "production", ...(args.length ? { then: args[1] } : {}) });
console.log(JSON.stringify(report));
process.exitCode = report.commandCode !== undefined && report.commandCode !== 0 ? report.commandCode : report.ok ? 0 : 1;
