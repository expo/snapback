// Minimal in-memory browser for the fixed Keycloak qualification realm. It
// drives the HTML authorization-code form and never uses a password grant.
const attribute = (tag, name) => {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return match?.[1] ?? match?.[2] ?? null;
};
const decodeHtml = value => value
  .replaceAll("&amp;", "&").replaceAll("&quot;", "\"")
  .replaceAll("&#39;", "'").replaceAll("&#x27;", "'");

export async function authorizeWithKeycloak(config, authorizationUrl, fail) {
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

  const entered = new URL(authorizationUrl);
  if (entered.searchParams.get("client_id") !== config.clientId
    || entered.searchParams.get("redirect_uri") !== config.redirectUri
    || entered.searchParams.get("code_challenge_method") !== "S256") fail();
  const page = await follow(providerUrl(entered));
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
  const action = providerUrl(new URL(decodeHtml(actionValue), page.url));
  const response = await request(action, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", referer: page.url.href },
    body: fields,
  });
  const finished = await follow(action, response);
  if (!finished.callback) fail();
  return finished.callback;
}
