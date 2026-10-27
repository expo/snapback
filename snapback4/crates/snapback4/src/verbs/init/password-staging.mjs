// API signatures: snapback4 guide api proof | client | auth | generated
// EDIT REGION: seedUsers plan below; leave host startup, roster and stop handling.
// The same password sign-in, rules and operator provision used by production.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { signup } from "snapback4/auth";
import { deploy, startServe } from "snapback4/proof";

// Generated from the declared provision(principal, role) signature, when present.
// For a custom provision signature, set args(account) as in guide staging.
// EDIT REGION: roles/counts/provision/args(account); accounts require private operator enrollment.
const seedUsers = SEED_PLAN;
// KEEP REGION: staging lifecycle and cleanup.
export async function startStaging(options = {}) {
  const directory = options.directory ?? mkdtempSync(join(tmpdir(), "snapback4-password-proof-"));
  const release = join(directory, "release");
  let host;
  try {
    await deploy(release, "snapback", { ...options, args: ["--staging"] });
    host = await startServe(release, { ...options, ...(seedUsers ? { seedUsers } : {}) });
    if (!seedUsers) {
      host.sessions = { users: [] };
      for (let n = 0; n < 2; n++) {
        const email = `proof-${randomUUID()}@example.test`, password = randomBytes(24).toString("base64url");
        const signed = await signup(host.url, email, password);
        if (!signed.ok) throw Error(`Password proof signup refused: ${signed.why.code}`);
        host.sessions.users.push({ ...signed.session, email, password });
      }
    }
    const stop = host.stop;
    let stopped;
    return { ...host, directory, stop: () => stopped ??= (async () => {
      await stop(); // Reap the writer before removing its store.
      if (!options.directory) rmSync(directory, { recursive: true, force: true });
    })() };
  } catch (error) {
    if (host) await host.stop();
    if (!options.directory) rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
