// Shared production account helper: real signup/login + operator provisioning.
// Fixed emails per role so every script (day2:proof, prod:serve, probe:serve)
// converges on the same accounts; login-or-signup makes reruns idempotent.
import { signup, login } from "snapback4/auth";
import { createClient } from "snapback4/client";
import { api } from "../snapback/generated/api.ts";

export const PROD_PASSWORD = "correct horse battery staple";
export const PROD_ROLES = ["owner", "frontdesk", "seamstress", "bride"];

export function prodEmails() {
  const out = {};
  for (const role of PROD_ROLES) {
    out[role] = [1, 2].map((i) => ({
      email: `studio-${role}${i}@example.test`,
      password: PROD_PASSWORD,
    }));
  }
  return out;
}

async function post(url, token, path, args) {
  const res = await fetch(url + path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ args }),
    signal: AbortSignal.timeout(15000),
  });
  return { status: res.status, body: await res.json() };
}

// Ensure two real users per role exist through the real sign-up path and carry
// the right role. Returns {role: [{email, password, principal, token}]}.
export async function ensureProdUsers(url, operatorToken) {
  const emails = prodEmails();
  const users = {};
  for (const role of PROD_ROLES) {
    users[role] = [];
    for (const account of emails[role]) {
      let session = null;
      const logged = await login(url, account.email, account.password);
      if (logged.ok) {
        session = logged.session;
      } else {
        const signed = await signup(url, account.email, account.password);
        if (!signed.ok) {
          throw new Error(`cannot sign in or up ${account.email}: ${JSON.stringify(signed.why ?? signed).slice(0, 200)}`);
        }
        session = signed.session;
      }
      const provisioned = await post(url, operatorToken, "/m/provision", {
        principal: session.principal,
        role,
      });
      if (provisioned.status !== 200 || provisioned.body.state !== "sent") {
        throw new Error(`provision ${role} failed: ${provisioned.status} ${JSON.stringify(provisioned.body).slice(0, 200)}`);
      }
      // Keep the complete session object: the client bindings need kind/scope/
      // expiresAt alongside principal/token (stripped sessions trip the
      // client-side liveness gate with E_AUTH on some first calls).
      users[role].push({ email: account.email, password: account.password, principal: session.principal, token: session.token, session });
    }
  }
  // Brides join the directory (upsert: safe to replay) so the desk can file.
  for (const [i, bride] of users.bride.entries()) {
    const client = createClient({ url, session: { principal: bride.principal, token: bride.token } });
    const wrote = await client.mutate(api.registerBride, { displayName: `Studio Bride ${i + 1}` });
    if (wrote.state !== "sent") throw new Error(`registerBride failed: ${JSON.stringify(wrote.why ?? wrote).slice(0, 200)}`);
  }
  return users;
}
