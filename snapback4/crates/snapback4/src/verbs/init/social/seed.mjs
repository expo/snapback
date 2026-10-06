// Run with Node 24 after `snapback4 check`, while the backend is running.
import { signup, login } from "snapback4/auth";
import { createClient } from "snapback4/client";
import { api } from "../snapback/generated/api.ts";

const url = process.env.SNAPBACK_URL ?? "http://127.0.0.1:4400";
const password = process.env.SEED_PASSWORD;
const count = Number(process.env.SEED_USERS ?? "2");
const mode = process.env.SEED_AUTH ?? "signup";
if (!password) throw Error("Set SEED_PASSWORD privately in the environment");
if (!Number.isSafeInteger(count) || count < 1 || count > 1000) throw Error("SEED_USERS must be 1..1000");
if (mode !== "signup" && mode !== "login") throw Error("SEED_AUTH must be signup or login");
const authenticate = mode === "signup" ? signup : login;

// Sequential admission respects the host's bounded password-hashing slots.
// Stop on refusal; do not turn every signup failure into a login or retry loop.
for (let n = 1; n <= count; n++) {
  const email = `seed${n}@example.test`;
  const result = await authenticate(url, email, password);
  if (!result.ok) throw Error(`Account ${n}: ${result.why.message}`);
  // Signup already returns a session; a separate login is only for later runs.
  const client = createClient({ url, session: result.session });
  try {
    const write = await client.mutate(api.saveProfile, { name: `Seed ${n}` });
    if (write.state !== "sent") throw Error(write.state === "failed" ? write.why.message : "Profile write pending");
    console.log(JSON.stringify({ email, principal: client.viewer() }));
  } finally {
    await client.signOut(); // Clears this client's credentials; remote logout is best effort.
  }
}
