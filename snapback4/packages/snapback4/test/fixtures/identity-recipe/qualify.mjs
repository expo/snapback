// Credentials-gated actual-provider witness. This drives Keycloak's browser
// login form and authorization-code redirect; it never uses a password grant.
import { readFile, stat } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { guest, logout, logoutAll } from "snapback4/auth";
import { createClient, mintId } from "snapback4/client";
import { api } from "./snapback/generated/api.ts";

const expected = Object.freeze({
  issuer: "http://127.0.0.1:38971/realms/sb4-b1a-20260917",
  clientId: "snapback4-b1a",
  redirectUri: "http://127.0.0.1:38972/auth/callback",
});
const backend = process.env.SNAPBACK4_URL ?? "http://127.0.0.1:38973";
const configPath = process.env.SNAPBACK4_OIDC_QUALIFICATION_CONFIG;
let stage = "configuration";

const fail = () => { throw new Error(`qualification failed during ${stage}`); };
const attribute = (tag, name) => {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return match?.[1] ?? match?.[2] ?? null;
};
const decodeHtml = value => value
  .replaceAll("&amp;", "&").replaceAll("&quot;", "\"")
  .replaceAll("&#39;", "'").replaceAll("&#x27;", "'");

async function readConfig() {
  if (!configPath) fail();
  const metadata = await stat(configPath);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) fail();
  const found = JSON.parse(await readFile(configPath, "utf8"));
  for (const key of ["issuer", "clientId", "clientSecret", "redirectUri", "username", "password"]) {
    if (typeof found[key] !== "string" || found[key].length === 0) fail();
  }
  if (found.issuer !== expected.issuer || found.clientId !== expected.clientId || found.redirectUri !== expected.redirectUri) fail();
  return found;
}

function browser(config) {
  const cookies = new Map();
  const issuer = new URL(config.issuer);
  const redirect = new URL(config.redirectUri);
  const absorb = response => {
    const values = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : response.headers.get("set-cookie") ? [response.headers.get("set-cookie")] : [];
    for (const value of values) {
      const pair = value.split(";", 1)[0];
      const at = pair.indexOf("=");
      if (at > 0) cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
  };
  const headers = extra => ({
    ...(cookies.size ? { cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; ") } : {}),
    ...extra,
  });
  const providerUrl = value => {
    const url = new URL(value);
    if (url.origin !== issuer.origin || !url.pathname.startsWith(`${issuer.pathname}/`)) fail();
    return url;
  };
  const callbackUrl = value => {
    const url = new URL(value);
    return url.origin === redirect.origin && url.pathname === redirect.pathname ? url : null;
  };
  const request = async (url, init = {}) => {
    const response = await fetch(url, { ...init, redirect: "manual", headers: headers(init.headers ?? {}) });
    absorb(response);
    return response;
  };
  const follow = async (start, initial) => {
    let url = providerUrl(start);
    let response = initial ?? await request(url);
    for (let redirects = 0; redirects < 12; redirects++) {
      if (response.status < 300 || response.status >= 400) return { url, response };
      const location = response.headers.get("location");
      if (!location) fail();
      const next = new URL(location, url);
      const callback = callbackUrl(next);
      if (callback) return { callback };
      url = providerUrl(next);
      response = await request(url);
    }
    fail();
  };
  return { request, follow, providerUrl };
}

async function authorize(config, authorizationUrl) {
  const agent = browser(config);
  const entered = new URL(authorizationUrl);
  if (entered.searchParams.get("client_id") !== config.clientId
    || entered.searchParams.get("redirect_uri") !== config.redirectUri
    || entered.searchParams.get("code_challenge_method") !== "S256") fail();
  const page = await agent.follow(agent.providerUrl(entered));
  if (page.callback || page.response.status !== 200) fail();
  const html = await page.response.text();
  const formTag = html.match(/<form\b[^>]*\baction\s*=\s*(?:"[^"]*"|'[^']*')[^>]*>/i)?.[0];
  const actionValue = formTag ? attribute(formTag, "action") : null;
  if (!actionValue) fail();
  const fields = new URLSearchParams();
  for (const tag of html.match(/<input\b[^>]*>/gi) ?? []) {
    if ((attribute(tag, "type") ?? "").toLowerCase() !== "hidden") continue;
    const name = attribute(tag, "name");
    if (name) fields.set(name, decodeHtml(attribute(tag, "value") ?? ""));
  }
  fields.set("username", config.username);
  fields.set("password", config.password);
  fields.set("credentialId", fields.get("credentialId") ?? "");
  const action = agent.providerUrl(new URL(decodeHtml(actionValue), page.url));
  const response = await agent.request(action, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", referer: page.url.href },
    body: fields,
  });
  const finished = await agent.follow(action, response);
  if (!finished.callback) fail();
  return finished.callback;
}

async function main() {
  const config = await readConfig();
  stage = "guest session";
  const signedIn = await guest(backend);
  if (!signedIn.ok || signedIn.session.kind !== "guest") fail();
  const client = createClient({ url: backend, session: signedIn.session });
  try {
    const binding = randomBytes(32).toString("base64url");
    const bindingHash = createHash("sha256").update(binding).digest("base64url");
    stage = "begin action";
    const begun = await client.act(api.beginOidc, { bindingHash }, { waitSeconds: 25 });
    if (begun.state !== "done") fail();
    const authorization = new URL(begun.result.authorizationUrl);
    const state = authorization.searchParams.get("state");
    if (!state) fail();
    stage = "provider login";
    const callback = await authorize(config, authorization);
    const code = callback.searchParams.get("code");
    const responseState = callback.searchParams.get("state");
    const responseIssuer = callback.searchParams.get("iss");
    if (!code || responseState !== state || responseIssuer !== config.issuer || callback.searchParams.has("error")) fail();
    stage = "complete action";
    const completionId = mintId();
    const completionArgs = {
      code, state, binding, error: null, iss: responseIssuer,
    };
    const completed = await client.act(api.completeOidc, completionArgs, { id: completionId, waitSeconds: 25 });
    if (completed.state !== "done" || !completed.result.principal.startsWith("oidc:")
      || completed.result.kind !== "oidc" || !completed.result.token || completed.result.expiresAt <= Date.now()) fail();
    stage = "issued session use";
    const issued = createClient({ url: backend, session: completed.result });
    try {
      const whoami = await issued.query(api.identityWhoami, {});
      if (!("data" in whoami) || whoami.data !== completed.result.principal) fail();
      await logout(backend, completed.result.token);
      const afterLogout = await issued.query(api.identityWhoami, {});
      if (!("denied" in afterLogout) || afterLogout.denied.code !== "E_AUTH") fail();
    } finally {
      await issued.close();
    }
    stage = "collection authority";
    const revoked = await logoutAll(backend, signedIn.session.token);
    if (!revoked.ok) fail();
    const stale = await client.act(api.completeOidc, completionArgs, { id: completionId, waitSeconds: 1 });
    if (!("denied" in stale) || stale.denied.code !== "E_AUTH") fail();
    const freshSignIn = await guest(backend);
    if (!freshSignIn.ok) fail();
    const unrelated = createClient({ url: backend, session: freshSignIn.session });
    try {
      const foreign = await unrelated.act(api.completeOidc, completionArgs, { id: completionId, waitSeconds: 1 });
      if (!("denied" in foreign) || foreign.denied.code !== "E_ACTION_UNKNOWN") fail();
    } finally {
      await unrelated.close();
    }
  } finally {
    await client.close();
  }
  process.stdout.write("qualification: ok — actual Keycloak flow, issued-session use, and collection-authority refusals passed\n");
}

main().catch(() => {
  process.stderr.write(`qualification: failed — ${stage}\n`);
  process.exitCode = 1;
});
