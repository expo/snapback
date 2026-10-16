import { oidcHandlers } from "snapback4/identity";
import { api } from "./generated/api.ts";
import { server } from "./generated/server.ts"; import { startServer } from "snapback4/server";

// Actual-provider qualification fixture. The confidential secret is declared
// in Quarry and supplied only as OIDC_CLIENT_SECRET to the supervised runtime.
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

export default server(startServer, { actions: { beginOidc: oidc.begin, completeOidc: oidc.complete } });
