import type { AuthConfig } from "convex/server";
import { devJwksDataUri } from "./dev_jwks";

export default {
  providers: [{
    type: "customJwt",
    issuer: "https://llp0102-linear-convex.local",
    applicationID: "llp0102-linear-convex",
    algorithm: "RS256",
    jwks: devJwksDataUri,
  }],
} satisfies AuthConfig;
