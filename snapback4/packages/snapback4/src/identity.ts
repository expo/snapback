import { createHash, timingSafeEqual } from "node:crypto";
import {
  ClientSecretPost,
  ClientError,
  Configuration,
  AuthorizationResponseError,
  ResponseBodyError,
  allowInsecureRequests,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  customFetch,
  discovery,
  enableNonRepudiationChecks,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
  type CustomFetch,
  type IDToken,
  type ServerMetadata,
} from "openid-client";
import type { Mutation, Principal, Query, Session } from "./contract.ts";
import { ServerError } from "./server-json.ts";
import { identityHandler, type IdentityRuntime } from "./server-private.ts";
import { ParkStep } from "./server-json.ts";
import { Retry } from "./worker.ts";

export interface OidcTransaction {
  readonly id: string;
  readonly beginInvocation: string;
  readonly admittingPrincipal: string;
  readonly configFingerprint: string;
  readonly bindingHash: string;
  readonly state: string;
  readonly nonce: string;
  readonly pkceVerifier: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly completionInvocation: string | null;
  readonly verifiedIssuer: string | null;
  readonly verifiedSubject: string | null;
  readonly email: string | null;
  readonly emailVerified: boolean | null;
}

export interface OidcTransactionOperations {
  readonly byInvocation: Query<{ readonly invocation: string }, OidcTransaction | null>;
  readonly byState: Query<{ readonly state: string }, OidcTransaction | null>;
  readonly begin: Mutation<Omit<OidcTransaction,
    "completionInvocation" | "verifiedIssuer" | "verifiedSubject" | "email" | "emailVerified"> & {
      readonly completionInvocation?: string | null | undefined;
      readonly verifiedIssuer?: string | null | undefined;
      readonly verifiedSubject?: string | null | undefined;
      readonly email?: string | null | undefined;
      readonly emailVerified?: boolean | null | undefined;
    }, unknown>;
  readonly claim: Mutation<{ readonly id: string; readonly completionInvocation: string }, unknown>;
  readonly verified: Mutation<{
    readonly id: string;
    readonly completionInvocation: string;
    readonly issuer: string;
    readonly subject: string;
    readonly email?: string | null | undefined;
    readonly emailVerified?: boolean | null | undefined;
  }, unknown>;
}

export interface OidcConfiguration<Secret extends string> {
  /** Exact issuer identifier used for discovery and ID-token validation. */
  readonly issuer: string;
  readonly clientId: string;
  /** Name declared in both action declarations' `secrets [...]` clause. */
  readonly clientSecret: Secret;
  /** Exact frontend callback. The frontend POSTs its code/state/binding to complete. */
  readonly redirectURI: string;
  readonly transactions: OidcTransactionOperations;
  readonly scopes?: readonly ("openid" | "email" | "profile")[];
  /** Required to use HTTP, and accepted only when issuer, callback and discovered endpoints use literal loopback hosts. */
  readonly development?: { readonly allowInsecureLoopback: true };
  /** 60–600 seconds; default 300. */
  readonly transactionTtlSeconds?: number;
  /** 1–30 days; default 7. */
  readonly sessionDays?: number;
  /** Application-defined Session.kind; default `oidc`. */
  readonly sessionKind?: string;
}

export interface OidcBeginArguments { readonly bindingHash: string }
export interface OidcBeginResult { readonly authorizationUrl: string }
export interface OidcCompleteArguments {
  readonly code?: string | null | undefined;
  readonly state: string;
  readonly binding: string;
  readonly error?: string | null | undefined;
  /** RFC 9207 authorization-response issuer, when the provider supplies it. */
  readonly iss?: string | null | undefined;
}
export type OidcSession = Session & { readonly principal: Principal };

const text = (value: unknown, minimum: number, maximum: number): value is string =>
  typeof value === "string" && value.length >= minimum && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
const loopback = (url: URL) => url.hostname === "127.0.0.1" || url.hostname === "[::1]";
const allowedEndpoint = (value: unknown, insecure: boolean): value is string => {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return !url.username && !url.password && (insecure ? loopback(url) && url.protocol === "http:" : url.protocol === "https:");
  } catch { return false; }
};
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("base64url");
const bindingDigest = (value: string) => createHash("sha256").update(value, "utf8").digest();
const definitiveValidationCodes = new Set([
  "OAUTH_JWT_TIMESTAMP_CHECK_FAILED", "OAUTH_JWT_CLAIM_COMPARISON_FAILED",
  "OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED", "OAUTH_KEY_SELECTION_FAILED",
]);

function knownValidationRefusal(error: ClientError): boolean {
  if (definitiveValidationCodes.has(error.code ?? "")) return true;
  if (error.code !== "OAUTH_INVALID_RESPONSE") return false;
  // In openid-client 6.8.8, the wrapped oauth4webapi cause distinguishes
  // token/JWKS response-shape failures ({body}) from validation of an actual
  // authorization response or ID token (raw JWS, {parameters}, {claims},
  // {header}, or signature material). Keep malformed response bodies
  // uncertain without matching error text.
  const wrapped = error.cause;
  const detail = wrapped instanceof Error ? wrapped.cause : undefined;
  if (typeof detail === "string") return true;
  return !!detail && typeof detail === "object"
    && ["parameters", "claims", "header", "signature"].some(field => Object.hasOwn(detail, field));
}

function validateTransaction(value: unknown): OidcTransaction {
  const row = value as Partial<OidcTransaction> | null;
  if (!row || !text(row.id, 1, 128) || !text(row.beginInvocation, 1, 128)
    || !text(row.admittingPrincipal, 1, 512) || !/^[A-Za-z0-9_-]{43}$/.test(row.configFingerprint ?? "")
    || !/^[A-Za-z0-9_-]{43}$/.test(row.bindingHash ?? "") || !text(row.state, 20, 256)
    || !text(row.nonce, 20, 256) || !text(row.pkceVerifier, 43, 128)
    || typeof row.createdAt !== "number" || !Number.isFinite(row.createdAt)
    || typeof row.expiresAt !== "number" || !Number.isFinite(row.expiresAt)
    || !(row.completionInvocation === null || text(row.completionInvocation, 1, 128))
    || !(row.verifiedIssuer === null || text(row.verifiedIssuer, 1, 2048))
    || !(row.verifiedSubject === null || text(row.verifiedSubject, 1, 1024))
    || !(row.email === null || text(row.email, 1, 320))
    || !(row.emailVerified === null || typeof row.emailVerified === "boolean")) {
    throw new ServerError("E_OIDC_RECIPE", "the private identity transaction row is invalid");
  }
  return row as OidcTransaction;
}

function validateSettings<Secret extends string>(config: OidcConfiguration<Secret>) {
  if (!config || typeof config !== "object") throw new ServerError("E_OIDC_CONFIG", "supply a fixed OIDC configuration");
  let issuerUrl: URL, redirectUrl: URL;
  try { issuerUrl = new URL(config.issuer); redirectUrl = new URL(config.redirectURI); }
  catch { throw new ServerError("E_OIDC_CONFIG", "issuer and redirectURI must be absolute URLs"); }
  const insecure = config.development?.allowInsecureLoopback === true;
  if (issuerUrl.search || issuerUrl.hash || issuerUrl.username || issuerUrl.password
    || redirectUrl.search || redirectUrl.hash || redirectUrl.username || redirectUrl.password) {
    throw new ServerError("E_OIDC_CONFIG", "issuer and redirectURI cannot contain credentials, query or fragment components");
  }
  if (insecure) {
    if (issuerUrl.protocol !== "http:" || redirectUrl.protocol !== "http:" || !loopback(issuerUrl) || !loopback(redirectUrl)) {
      throw new ServerError("E_OIDC_CONFIG", "insecure development requires literal-loopback HTTP issuer and redirectURI values");
    }
  } else if (issuerUrl.protocol !== "https:" || redirectUrl.protocol !== "https:") {
    throw new ServerError("E_OIDC_CONFIG", "production OIDC requires HTTPS issuer and redirectURI values");
  }
  if (!text(config.clientId, 1, 512) || !text(config.clientSecret, 1, 128)) throw new ServerError("E_OIDC_CONFIG", "clientId and clientSecret name are required");
  const scopes = [...(config.scopes ?? ["openid", "email"])] as ("openid" | "email" | "profile")[];
  if (!scopes.includes("openid") || new Set(scopes).size !== scopes.length
    || scopes.some(scope => !["openid", "email", "profile"].includes(scope))) {
    throw new ServerError("E_OIDC_CONFIG", "OIDC scopes must be a unique subset of openid, email and profile including openid");
  }
  const ttl = config.transactionTtlSeconds ?? 300;
  const days = config.sessionDays ?? 7;
  const kind = config.sessionKind ?? "oidc";
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 600) throw new ServerError("E_OIDC_CONFIG", "transactionTtlSeconds must be an integer from 60 through 600");
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new ServerError("E_OIDC_CONFIG", "sessionDays must be an integer from 1 through 30");
  if (!text(kind, 1, 64)) throw new ServerError("E_OIDC_CONFIG", "sessionKind must be 1–64 printable characters");
  const fixed = Object.freeze({ issuer: config.issuer, issuerUrl: new URL(config.issuer), clientId: config.clientId,
    clientSecret: config.clientSecret, redirectURI: config.redirectURI, scopes: Object.freeze(scopes), insecure, ttl, days, kind,
    transactions: Object.freeze({ ...config.transactions }) });
  const configFingerprint = fingerprint(["snapback4:oidc-config:v1", fixed.issuer, fixed.clientId, fixed.redirectURI, fixed.scopes, fixed.clientSecret, fixed.insecure]);
  return { ...fixed, configFingerprint };
}

function assertProviderMetadata(provider: Configuration, issuer: string, insecure: boolean): void {
  const metadata = provider.serverMetadata();
  if (metadata.issuer !== issuer || !allowedEndpoint(metadata.authorization_endpoint, insecure)
    || !allowedEndpoint(metadata.token_endpoint, insecure) || !allowedEndpoint(metadata.jwks_uri, insecure)
    || !metadata.response_types_supported?.includes("code")
    || !metadata.code_challenge_methods_supported?.includes("S256")) {
    throw new ServerError("E_OIDC_PROVIDER", "the discovered provider metadata does not match the fixed secure configuration");
  }
}

interface DurableProviderMetadata {
  readonly protocol: "oidc-provider-metadata/v2";
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
  readonly responseTypesSupported: readonly string[];
  readonly codeChallengeMethodsSupported: readonly string[];
  readonly subjectTypesSupported: readonly string[] | null;
  readonly idTokenSigningAlgValuesSupported: readonly string[] | null;
  readonly tokenEndpointAuthMethodsSupported: readonly string[] | null;
  readonly tokenEndpointAuthSigningAlgValuesSupported: readonly string[] | null;
  readonly authorizationResponseIssParameterSupported: boolean | null;
}

function metadataList(value: unknown, required: boolean): readonly string[] | null {
  if (value === undefined && !required) return null;
  if (!Array.isArray(value) || value.length === 0 || value.length > 64
    || value.some(item => !text(item, 1, 128)) || new Set(value).size !== value.length) {
    throw new ServerError("E_OIDC_PROVIDER", "the provider metadata contains an invalid public capability list");
  }
  return Object.freeze([...value] as string[]);
}

function durableProviderMetadata(value: unknown, issuer: string, insecure: boolean): DurableProviderMetadata {
  const metadata = value as Partial<DurableProviderMetadata> & Record<string, unknown> | null;
  const expectedKeys = [
    "authorizationEndpoint", "authorizationResponseIssParameterSupported", "codeChallengeMethodsSupported",
    "idTokenSigningAlgValuesSupported", "issuer", "jwksUri", "protocol", "responseTypesSupported",
    "subjectTypesSupported", "tokenEndpoint", "tokenEndpointAuthMethodsSupported",
    "tokenEndpointAuthSigningAlgValuesSupported",
  ];
  if (!metadata || metadata.protocol !== "oidc-provider-metadata/v2" || metadata.issuer !== issuer
    || Object.keys(metadata).sort().join("\0") !== expectedKeys.sort().join("\0")
    || !allowedEndpoint(metadata.authorizationEndpoint, insecure)
    || !allowedEndpoint(metadata.tokenEndpoint, insecure) || !allowedEndpoint(metadata.jwksUri, insecure)
    || !(metadata.authorizationResponseIssParameterSupported === null
      || typeof metadata.authorizationResponseIssParameterSupported === "boolean")) {
    throw new ServerError("E_OIDC_PROVIDER", "the durable provider metadata does not match the fixed secure configuration");
  }
  const result: DurableProviderMetadata = Object.freeze({
    protocol: "oidc-provider-metadata/v2",
    issuer: metadata.issuer,
    authorizationEndpoint: metadata.authorizationEndpoint,
    tokenEndpoint: metadata.tokenEndpoint,
    jwksUri: metadata.jwksUri,
    responseTypesSupported: metadataList(metadata.responseTypesSupported, true)!,
    codeChallengeMethodsSupported: metadataList(metadata.codeChallengeMethodsSupported, true)!,
    subjectTypesSupported: metadataList(metadata.subjectTypesSupported ?? undefined, false),
    idTokenSigningAlgValuesSupported: metadataList(metadata.idTokenSigningAlgValuesSupported ?? undefined, false),
    tokenEndpointAuthMethodsSupported: metadataList(metadata.tokenEndpointAuthMethodsSupported ?? undefined, false),
    tokenEndpointAuthSigningAlgValuesSupported: metadataList(metadata.tokenEndpointAuthSigningAlgValuesSupported ?? undefined, false),
    authorizationResponseIssParameterSupported: metadata.authorizationResponseIssParameterSupported,
  });
  if (!result.responseTypesSupported.includes("code") || !result.codeChallengeMethodsSupported.includes("S256")) {
    throw new ServerError("E_OIDC_PROVIDER", "the durable provider metadata does not support the fixed secure flow");
  }
  return result;
}

function publicProviderMetadata(provider: Configuration, issuer: string, insecure: boolean): DurableProviderMetadata {
  assertProviderMetadata(provider, issuer, insecure);
  const metadata = provider.serverMetadata();
  return durableProviderMetadata({
    protocol: "oidc-provider-metadata/v2",
    issuer: metadata.issuer,
    authorizationEndpoint: metadata.authorization_endpoint,
    tokenEndpoint: metadata.token_endpoint,
    jwksUri: metadata.jwks_uri,
    responseTypesSupported: metadata.response_types_supported,
    codeChallengeMethodsSupported: metadata.code_challenge_methods_supported,
    subjectTypesSupported: metadata.subject_types_supported ?? null,
    idTokenSigningAlgValuesSupported: metadata.id_token_signing_alg_values_supported ?? null,
    tokenEndpointAuthMethodsSupported: metadata.token_endpoint_auth_methods_supported ?? null,
    tokenEndpointAuthSigningAlgValuesSupported: metadata.token_endpoint_auth_signing_alg_values_supported ?? null,
    authorizationResponseIssParameterSupported: metadata.authorization_response_iss_parameter_supported ?? null,
  }, issuer, insecure);
}

function matchesBinding(expected: string, binding: string): boolean {
  if (!text(binding, 32, 1024) || !/^[A-Za-z0-9_-]{43}$/.test(expected)) return false;
  const decoded = Buffer.from(expected, "base64url");
  const actual = bindingDigest(binding);
  return decoded.length === actual.length && timingSafeEqual(decoded, actual);
}

function minimalClaims(claims: IDToken | undefined, expectedIssuer: string, clientId: string, now: number) {
  if (!claims) throw new ServerError("E_OIDC_EXCHANGE", "the verified ID token has no claims");
  const issuer = claims.iss, subject = claims.sub;
  const audience = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
  const nowSeconds = Math.floor(now / 1000);
  if (issuer !== expectedIssuer || !text(subject, 1, 1024) || !Array.isArray(audience) || !audience.includes(clientId)
    || (claims.azp !== undefined && claims.azp !== clientId) || (audience.length > 1 && claims.azp !== clientId)
    || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)
    || claims.iat > nowSeconds + 60 || claims.iat < nowSeconds - 600 || claims.exp <= nowSeconds || claims.exp <= claims.iat) {
    throw new ServerError("E_OIDC_EXCHANGE", "the verified ID token claims were refused");
  }
  const email = typeof claims.email === "string" && text(claims.email, 1, 320) ? claims.email : null;
  const emailVerified = email !== null && typeof claims.email_verified === "boolean" ? claims.email_verified : null;
  return { issuer, subject, email, emailVerified } as const;
}

// @ref LLP 3000.009#7 — identity is a packaged server-runtime adapter over
// ordinary declared actions and managed recipe rows, never an engine protocol.
export function oidcHandlers<Secret extends string>(configuration: OidcConfiguration<Secret>) {
  const fixed = validateSettings(configuration);
  const configureProvider = (metadataValue: unknown, secret: string, runtime: IdentityRuntime): Configuration => {
    const metadata = durableProviderMetadata(metadataValue, fixed.issuer, fixed.insecure);
    const server: ServerMetadata = {
      issuer: metadata.issuer,
      authorization_endpoint: metadata.authorizationEndpoint,
      token_endpoint: metadata.tokenEndpoint,
      jwks_uri: metadata.jwksUri,
      response_types_supported: [...metadata.responseTypesSupported],
      code_challenge_methods_supported: [...metadata.codeChallengeMethodsSupported],
      ...(metadata.subjectTypesSupported ? { subject_types_supported: [...metadata.subjectTypesSupported] } : {}),
      ...(metadata.idTokenSigningAlgValuesSupported
        ? { id_token_signing_alg_values_supported: [...metadata.idTokenSigningAlgValuesSupported] } : {}),
      ...(metadata.tokenEndpointAuthMethodsSupported
        ? { token_endpoint_auth_methods_supported: [...metadata.tokenEndpointAuthMethodsSupported] } : {}),
      ...(metadata.tokenEndpointAuthSigningAlgValuesSupported
        ? { token_endpoint_auth_signing_alg_values_supported: [...metadata.tokenEndpointAuthSigningAlgValuesSupported] } : {}),
      ...(metadata.authorizationResponseIssParameterSupported === null ? {}
        : { authorization_response_iss_parameter_supported: metadata.authorizationResponseIssParameterSupported }),
    };
    const configured = new Configuration(server, fixed.clientId,
      { client_secret: secret, redirect_uris: [fixed.redirectURI], response_types: ["code"] }, ClientSecretPost(secret));
    configured[customFetch] = runtime.providerFetch as CustomFetch;
    configured.timeout = 10;
    if (fixed.insecure) allowInsecureRequests(configured);
    enableNonRepudiationChecks(configured);
    assertProviderMetadata(configured, fixed.issuer, fixed.insecure);
    return configured;
  };
  const discoverProvider = async (secret: string, runtime: IdentityRuntime, signal: AbortSignal): Promise<Configuration> => {
    try {
      const execute: ((config: Configuration) => void)[] = [enableNonRepudiationChecks];
      if (fixed.insecure) execute.push(allowInsecureRequests);
      const found = await discovery(fixed.issuerUrl, fixed.clientId,
        { client_secret: secret, redirect_uris: [fixed.redirectURI], response_types: ["code"] },
        ClientSecretPost(secret), { execute, timeout: 10, [customFetch]: runtime.providerFetch as CustomFetch });
      assertProviderMetadata(found, fixed.issuer, fixed.insecure);
      return found;
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof ServerError) throw error;
      throw new Retry("the fixed OIDC provider could not be discovered");
    }
  };

  const begin = identityHandler<OidcBeginArguments, OidcBeginResult, Secret>(async (args, ctx, runtime) => {
    if (!args || !/^[A-Za-z0-9_-]{43}$/.test(args.bindingHash ?? "")) throw new ServerError("E_OIDC_BINDING", "supply a SHA-256 browser binding hash");
    const clientSecret = ctx.secrets[fixed.clientSecret];
    const discovered = await discoverProvider(clientSecret, runtime, ctx.invocation.signal);
    let transaction = await runtime.query(fixed.transactions.byInvocation, { invocation: ctx.invocation.id });
    if (transaction === null) {
      // Quarry `time` is integer epoch milliseconds; the action clock adds a
      // monotonic fractional elapsed duration to its server-issued base.
      const createdAt = Math.floor(runtime.now());
      const pkceVerifier = randomPKCECodeVerifier();
      const row: OidcTransaction = {
        id: ctx.writeIdFor("oidc.transaction"), beginInvocation: ctx.invocation.id, admittingPrincipal: ctx.principal,
        configFingerprint: fixed.configFingerprint, bindingHash: args.bindingHash, state: randomState(), nonce: randomNonce(), pkceVerifier,
        createdAt, expiresAt: createdAt + fixed.ttl * 1000, completionInvocation: null,
        verifiedIssuer: null, verifiedSubject: null, email: null, emailVerified: null,
      };
      await runtime.mutate(fixed.transactions.begin, row, ctx.writeIdFor("oidc.begin"));
      transaction = await runtime.query(fixed.transactions.byInvocation, { invocation: ctx.invocation.id });
    }
    const stored = validateTransaction(transaction);
    if (stored.beginInvocation !== ctx.invocation.id || stored.admittingPrincipal !== ctx.principal
      || stored.configFingerprint !== fixed.configFingerprint || stored.bindingHash !== args.bindingHash
      || stored.expiresAt <= runtime.now() || stored.expiresAt - stored.createdAt > fixed.ttl * 1000) {
      throw new ServerError("E_OIDC_TRANSACTION", "the identity transaction does not match this invocation");
    }
    const codeChallenge = await calculatePKCECodeChallenge(stored.pkceVerifier);
    const authorizationUrl = buildAuthorizationUrl(discovered, {
      redirect_uri: fixed.redirectURI, scope: fixed.scopes.join(" "), state: stored.state, nonce: stored.nonce,
      code_challenge: codeChallenge, code_challenge_method: "S256", response_mode: "query",
    });
    return { authorizationUrl: authorizationUrl.href };
  });

  const complete = identityHandler<OidcCompleteArguments, OidcSession, Secret>(async (args, ctx, runtime) => {
    if (!args || (args.error !== null && args.error !== undefined) || !text(args.code, 1, 4096)
      || !text(args.state, 20, 256) || !text(args.binding, 32, 1024)
      || !(args.iss === null || args.iss === undefined || text(args.iss, 1, 2048))) {
      throw new ServerError("E_OIDC_CALLBACK", "the provider callback was refused");
    }
    const code = args.code;
    const found = await runtime.query(fixed.transactions.byState, { state: args.state });
    if (found === null) throw new ServerError("E_OIDC_CALLBACK", "the provider callback was refused");
    let stored = validateTransaction(found);
    if (stored.admittingPrincipal !== ctx.principal || stored.configFingerprint !== fixed.configFingerprint
      || stored.state !== args.state || stored.expiresAt <= runtime.now() || !matchesBinding(stored.bindingHash, args.binding)) {
      throw new ServerError("E_OIDC_CALLBACK", "the provider callback was refused");
    }
    if (stored.completionInvocation !== null && stored.completionInvocation !== ctx.invocation.id) {
      throw new ServerError("E_OIDC_REPLAY", "this identity transaction is already completing elsewhere");
    }
    await runtime.mutate(fixed.transactions.claim,
      { id: stored.id, completionInvocation: ctx.invocation.id }, ctx.writeIdFor("oidc.claim"));
    stored = validateTransaction(await runtime.query(fixed.transactions.byState, { state: args.state }));
    if (stored.completionInvocation !== ctx.invocation.id || stored.expiresAt <= runtime.now()) {
      throw new ServerError("E_OIDC_REPLAY", "this identity transaction cannot be completed by this invocation");
    }
    const exchangeInput = {
      transaction: stored.id, configFingerprint: fixed.configFingerprint,
      codeHash: fingerprint(["snapback4:oidc-code:v1", code]), state: args.state, responseIssuer: args.iss ?? null,
    };
    const markerInput = { transaction: stored.id, configFingerprint: fixed.configFingerprint, protocol: "oidc-exchange/v2" };
    const markerResult = { protocol: "oidc-exchange/v2" } as const;
    const runV2Exchange = async (reconcilingOuter: boolean) => {
      const marker = await ctx.step("oidc.exchange.v2.marker", markerInput,
        reconcilingOuter
          ? () => { throw new ParkStep("an unfinished legacy OIDC exchange has no durable v2 admission marker"); }
          : () => markerResult);
      if (!marker || marker.protocol !== markerResult.protocol || Object.keys(marker).length !== 1) {
        throw new ParkStep("the durable OIDC v2 admission marker is invalid");
      }

      const discoveryInput = { transaction: stored.id, configFingerprint: fixed.configFingerprint, issuer: fixed.issuer };
      const discoverMetadata = async () => publicProviderMetadata(
        await discoverProvider(ctx.secrets[fixed.clientSecret], runtime, ctx.invocation.signal), fixed.issuer, fixed.insecure,
      );
      let discoveryRefusal: ServerError | undefined;
      let metadata: DurableProviderMetadata;
      try {
        metadata = await ctx.step("oidc.exchange.v2.discovery", discoveryInput, discoverMetadata, {
          reconcile: async () => {
            try { return await discoverMetadata(); }
            catch (error) {
              // Generic GiveUp during reconciliation parks. A known metadata
              // refusal is authoritative and must remain a terminal refusal.
              if (error instanceof ServerError) {
                discoveryRefusal = error;
                throw new Error("the durable OIDC discovery was refused");
              }
              throw error;
            }
          },
        });
      } catch (error) {
        if (discoveryRefusal) throw discoveryRefusal;
        throw error;
      }
      const discovered = configureProvider(metadata, ctx.secrets[fixed.clientSecret], runtime);
      try {
        return await ctx.step("oidc.exchange.v2.token", exchangeInput, async () => {
          try {
            const callback = new URL(fixed.redirectURI);
            callback.searchParams.set("code", code);
            callback.searchParams.set("state", args.state);
            if (typeof args.iss === "string") callback.searchParams.set("iss", args.iss);
            const tokens = await authorizationCodeGrant(discovered, callback, {
              expectedState: stored.state, expectedNonce: stored.nonce, pkceCodeVerifier: stored.pkceVerifier, idTokenExpected: true,
            });
            return { ok: true as const, claims: minimalClaims(tokens.claims(), fixed.issuer, fixed.clientId, runtime.now()) };
          } catch (error) {
            // A closed invocation must preserve cancellation/deadline/refusal
            // semantics. It must not attempt to park through lost authority.
            if (ctx.invocation.signal.aborted) throw ctx.invocation.signal.reason;
            if (error instanceof ServerError
              || (error instanceof ResponseBodyError && error.error === "invalid_grant")
              || error instanceof AuthorizationResponseError
              || (error instanceof ClientError && knownValidationRefusal(error))) {
              return { ok: false as const };
            }
            // The token request or subsequent validation may have consumed the
            // code. This phase has no reconcile callback and can never POST it
            // again after an uncertain outcome.
            throw new ParkStep("the OIDC exchange outcome is uncertain");
          }
        });
      } catch (error) {
        if (error instanceof ServerError && error.refusal.code === "E_STEP_PARKED") {
          throw new ParkStep("the one-time OIDC token phase is parked");
        }
        throw error;
      }
    };
    let exchangeRefusal: ServerError | undefined;
    let exchange: Awaited<ReturnType<typeof runV2Exchange>>;
    try {
      exchange = await ctx.step("oidc.exchange", exchangeInput, () => runV2Exchange(false), {
        reconcile: async () => {
          try { return await runV2Exchange(true); }
          catch (error) {
            if (error instanceof ServerError && error.refusal.code !== "E_STEP_PARKED") {
              exchangeRefusal = error;
              throw new Error("the OIDC v2 exchange was refused");
            }
            throw error;
          }
        },
      });
    } catch (error) {
      if (exchangeRefusal) throw exchangeRefusal;
      throw error;
    }
    if (!exchange.ok) throw new ServerError("E_OIDC_EXCHANGE", "the authorization code exchange or ID token verification failed");
    const claims = exchange.claims;
    await runtime.mutate(fixed.transactions.verified, {
      id: stored.id, completionInvocation: ctx.invocation.id, issuer: claims.issuer, subject: claims.subject,
      email: claims.email, emailVerified: claims.emailVerified,
    }, ctx.writeIdFor("oidc.verified"));
    stored = validateTransaction(await runtime.query(fixed.transactions.byState, { state: args.state }));
    if (stored.completionInvocation !== ctx.invocation.id || stored.verifiedIssuer !== claims.issuer
      || stored.verifiedSubject !== claims.subject || stored.expiresAt <= runtime.now()) {
      throw new ServerError("E_OIDC_TRANSACTION", "the verified identity transaction did not settle");
    }
    let minted: OidcSession | undefined;
    const mintInput = {
      transaction: stored.id, issuer: claims.issuer, subject: claims.subject, kind: fixed.kind, days: fixed.days,
      protocol: "oidc-mint-bound/v1" as const,
    };
    const deliver = async (recover: boolean) => {
      minted = await (recover ? runtime.recoverMint : runtime.mint)(claims.issuer, claims.subject, fixed.kind, fixed.days) as OidcSession;
      return { minted: true as const, principal: minted.principal, kind: minted.kind, expiresAt: minted.expiresAt };
    };
    let recoveryRefusal: ServerError | undefined;
    let completion: Awaited<ReturnType<typeof deliver>>;
    try {
      completion = await ctx.step("oidc.mint", mintInput, () => deliver(false), {
        reconcile: async () => {
          try { return await deliver(true); }
          catch (error) {
            // Generic application GiveUp during reconciliation parks. A
            // terminal core authority/input refusal is already authoritative
            // and must instead fail this invocation without a fallback mint.
            if (error instanceof ServerError) {
              recoveryRefusal = error;
              throw new Error("the bound identity mint recovery was refused");
            }
            throw error;
          }
        },
      });
    } catch (error) {
      if (recoveryRefusal) throw recoveryRefusal;
      throw error;
    }
    // A completed step contains only non-secret delivery metadata. If the
    // plaintext token left this handler with a lost final acknowledgement,
    // explicitly replace it in the invocation-bound family before returning.
    if (completion.minted && !minted) minted = await runtime.recoverMint(
      claims.issuer, claims.subject, fixed.kind, fixed.days,
    ) as OidcSession;
    if (!completion.minted || !minted || minted.principal !== completion.principal || minted.kind !== completion.kind
      || minted.expiresAt !== completion.expiresAt) {
      throw new ServerError("E_OIDC_HANDOFF", "the minted session token is no longer available to this live handler");
    }
    return minted;
  });

  return Object.freeze({ begin, complete });
}
