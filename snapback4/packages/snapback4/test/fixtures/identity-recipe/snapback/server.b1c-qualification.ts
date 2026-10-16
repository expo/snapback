import { oidcHandlers } from "snapback4/identity";
import { api } from "./generated/api.ts";
import { server } from "./generated/server.ts"; import { startServer } from "snapback4/server";
import { qualificationFetch } from "./qualification-fetch.ts";

// Test instrument only: qualify-b1c.mjs copies this over server.ts in its
// private disposable application. It is not another application backend.
const oidc = oidcHandlers({
  issuer: "http://127.0.0.1:38971/realms/sb4-b1a-20260917",
  clientId: "snapback4-b1a",
  clientSecret: "OIDC_CLIENT_SECRET",
  redirectURI: "http://127.0.0.1:38972/auth/callback",
  development: { allowInsecureLoopback: true },
  transactions: {
    byInvocation: api.identityByInvocation,
    byState: api.identityByState,
    begin: api.identityBegin,
    claim: api.identityClaim,
    verified: api.identityVerified,
  },
});

export default server(startServer,
  { actions: { beginOidc: oidc.begin, completeOidc: oidc.complete } },
  { fetch: qualificationFetch, lease: 1, wait: 1, batch: 1, statusIntervalMs: 50 },
);
