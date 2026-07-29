import { generateKeyPair, exportJWK } from "jose";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const runtime = resolve(root, ".arm-runtime");
await mkdir(runtime, { recursive: true, mode: 0o700 });
const { publicKey, privateKey } = await generateKeyPair("RS256", {
  modulusLength: 2048,
  extractable: true,
});
const publicJwk = { ...(await exportJWK(publicKey)), kid: "llp0102-linear-dev", use: "sig", alg: "RS256" };
const privateJwk = { ...(await exportJWK(privateKey)), kid: "llp0102-linear-dev", use: "sig", alg: "RS256" };
const dataUri = `data:application/json;base64,${Buffer.from(JSON.stringify({ keys: [publicJwk] })).toString("base64")}`;
await writeFile(
  resolve(root, "convex/dev_jwks.ts"),
  `// Generated public development JWKS; contains no private key.\nexport const devJwksDataUri = ${JSON.stringify(dataUri)};\n`,
);
await writeFile(resolve(runtime, "private-jwk.json"), JSON.stringify(privateJwk), { mode: 0o600 });
process.stdout.write("development auth fixture generated (public key only in source)\n");
