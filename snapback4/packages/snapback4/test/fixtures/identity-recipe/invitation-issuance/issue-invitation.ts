import { createHash, randomBytes } from "node:crypto";
import { ParkStep, ServerError } from "snapback4/server";
import { Retry } from "snapback4/worker";
import { ResendUnresolved, sendResendEmail } from "./resend.ts";

type Json = null | boolean | number | string | Json[] | { readonly [key: string]: Json };
type Operation = { readonly kind: "query" | "mutation"; readonly name: string };
type Read = { readonly data: unknown; readonly complete: boolean; readonly next?: unknown; readonly cut?: unknown }
  | { readonly denied: { readonly code: string } }
  | { readonly capped: true };
type Write = { readonly state: "pending"; readonly id?: string }
  | { readonly state: "failed"; readonly why?: { readonly code?: string } }
  | { readonly state: "sent"; readonly result?: unknown; readonly replayed?: boolean };

export interface InvitationIssuanceContext {
  readonly principal: string;
  readonly invocation: { readonly id: string; readonly signal: AbortSignal };
  readonly secrets: Readonly<Record<"MAIL_API_KEY", string>>;
  query(operation: Operation, args: Readonly<Record<string, unknown>>): Promise<Read>;
  mutate(operation: Operation, args: Readonly<Record<string, unknown>>, options: { readonly id: string }): Promise<Write>;
  step<T extends Json>(name: string, input: Json, run: (key: string) => T | Promise<T>, options?: {
    readonly reconcile?: (key: string) => T | Promise<T>;
  }): Promise<T>;
  writeIdFor(label: string): string;
}

export interface InvitationIssuanceOperations {
  readonly adminOrganizationSummary: Operation;
  readonly invitationDeliveryState: Operation;
  readonly organizationRecordInvitation: Operation;
}

export interface InvitationIssuanceConfig {
  /** Trusted HTTPS frontend URL with no credentials, query or fragment. */
  readonly acceptanceBase: string;
  /** A Resend-authorized sender fixed by deployment configuration. */
  readonly from: string;
  readonly subject: string;
}

interface PreparedInvitation {
  readonly protocol: "invite.prepare/v1";
  readonly rawToken: string;
  readonly tokenHash: string;
  readonly configSha256: string;
  readonly credentialNamespaceFingerprint: string;
  readonly frozen: {
    readonly acceptanceBase: string;
    readonly from: string;
    readonly subject: string;
    readonly template: "organization-invitation/v1";
  };
}

interface DeliveryState {
  readonly id: string;
  readonly organization: string;
  readonly recipientEmail: string;
  readonly issuer: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly status: string;
  readonly serverNow: number;
}

const RECONCILIATION_HORIZON_MS = 10 * 60 * 1000;
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const canonical = (value: Readonly<Record<string, string>>) => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));

function freezeConfig(config: InvitationIssuanceConfig): PreparedInvitation["frozen"] {
  let url: URL;
  try { url = new URL(config.acceptanceBase); }
  catch { throw new ServerError("E_INVITATION_CONFIG", "the invitation acceptance URL is invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
    || url.origin === "null" || url.href !== config.acceptanceBase) {
    throw new ServerError("E_INVITATION_CONFIG", "the invitation acceptance URL must be an exact trusted HTTPS URL without credentials, query or fragment");
  }
  if (typeof config.from !== "string" || config.from.length < 1 || config.from.length > 320 || /[\r\n]/.test(config.from)
    || typeof config.subject !== "string" || config.subject.length < 1 || config.subject.length > 200 || /[\r\n]/.test(config.subject)) {
    throw new ServerError("E_INVITATION_CONFIG", "the invitation sender or subject is invalid");
  }
  return Object.freeze({
    acceptanceBase: url.href,
    from: config.from,
    subject: config.subject,
    template: "organization-invitation/v1" as const,
  });
}

function fingerprints(frozen: PreparedInvitation["frozen"], apiKey: string) {
  return {
    configSha256: hash(canonical(frozen)),
    credentialNamespaceFingerprint: hash(`snapback4:resend-credential-namespace:v1\0${apiKey}`),
  };
}

function authoritativeData(read: Read, purpose: string): unknown {
  if (!("data" in read) || read.complete !== true || read.next !== undefined && read.next !== null
    || read.cut !== undefined && read.cut !== null) {
    throw new Retry(`the ${purpose} query did not return an authoritative point result`);
  }
  if (read.data === null || read.data === undefined) {
    throw new Retry(`the ${purpose} query returned no authoritative row`);
  }
  return read.data;
}

function deliveryState(value: unknown): DeliveryState {
  if (!value || typeof value !== "object") throw new Retry("the invitation delivery-state result was invalid");
  const row = value as Record<string, unknown>;
  for (const name of ["id", "organization", "recipientEmail", "issuer", "status"] as const) {
    if (typeof row[name] !== "string") throw new Retry("the invitation delivery-state result was invalid");
  }
  for (const name of ["issuedAt", "expiresAt", "serverNow"] as const) {
    if (!Number.isSafeInteger(row[name])) throw new Retry("the invitation delivery-state result was invalid");
  }
  return row as unknown as DeliveryState;
}

function providerBody(prepared: PreparedInvitation, invitation: string, organization: string, recipientEmail: string): string {
  const target = new URL(prepared.frozen.acceptanceBase);
  target.hash = new URLSearchParams({ invitation, token: prepared.rawToken }).toString();
  const link = target.href;
  const text = `You have been invited to organization ${organization}. Sign in as ${recipientEmail}, then open ${link}`;
  const htmlLink = link.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return JSON.stringify({
    from: prepared.frozen.from,
    to: [recipientEmail],
    subject: prepared.frozen.subject,
    text,
    html: `<p>You have been invited to an organization.</p><p><a href="${htmlLink}">Accept invitation</a></p>`,
  });
}

function park(): never {
  throw new ParkStep("the invitation delivery outcome needs operator reconciliation");
}

// @ref LLP 3000.009#5.2 — prepare is durable before managed writes; uncertain delivery reuses one provider key or parks.
// @ref LLP 3000.009#7 — identity provider protocol stays in the optional application server adapter.
export function invitationIssuanceHandler(
  operations: InvitationIssuanceOperations,
  config: InvitationIssuanceConfig,
  dependencies: { readonly fetch?: typeof fetch } = {},
) {
  return async function issueInvitation(
    args: { readonly organization: string; readonly recipientEmail: string },
    ctx: InvitationIssuanceContext,
  ): Promise<{ invitation: string; delivery: "accepted" | "not-sent"; providerMessageId: string | null }> {
    if (typeof args.organization !== "string" || typeof args.recipientEmail !== "string"
      || args.recipientEmail.length < 1 || args.recipientEmail.length > 320 || args.recipientEmail.trim() !== args.recipientEmail) {
      throw new ServerError("E_INVITATION_INPUT", "the invitation arguments are invalid");
    }

    // This ordinary point query is the initial current-admin preflight. No
    // token exists until its complete result has been checked.
    authoritativeData(await ctx.query(operations.adminOrganizationSummary, {
      organization: args.organization,
    }), "organization-admin preflight");

    const frozen = freezeConfig(config);
    const currentFingerprints = fingerprints(frozen, ctx.secrets.MAIL_API_KEY);
    const prepare = (): PreparedInvitation => {
      const rawToken = randomBytes(32).toString("base64url");
      return {
        protocol: "invite.prepare/v1",
        rawToken,
        tokenHash: hash(rawToken),
        ...currentFingerprints,
        frozen,
      };
    };
    const prepared = await ctx.step("invite.prepare/v1", {
      protocol: "invite.prepare/v1",
      organization: args.organization,
      recipientEmail: args.recipientEmail,
    }, prepare, { reconcile: prepare });

    const invitation = ctx.writeIdFor("invite.entity/v1");
    let written: Write;
    try {
      written = await ctx.mutate(operations.organizationRecordInvitation, {
        id: invitation,
        organization: args.organization,
        recipientEmail: args.recipientEmail,
        tokenHash: prepared.tokenHash,
      }, { id: ctx.writeIdFor("invite.record/v1") });
    } catch {
      throw new Retry("the invitation write outcome is uncertain");
    }
    if (written.state === "pending") throw new Retry("the invitation write outcome is uncertain");
    if (written.state !== "sent") throw new ServerError("E_INVITATION_WRITE", "the invitation could not be recorded");

    // Never rely on a mutation result: replayed sent receipts intentionally
    // need not retain one. The exact-ID query is the authoritative row source.
    const recorded = deliveryState(authoritativeData(await ctx.query(operations.invitationDeliveryState, {
      invitation,
    }), "invitation delivery-state"));
    if (recorded.id !== invitation || recorded.organization !== args.organization
      || recorded.recipientEmail !== args.recipientEmail || recorded.issuer !== ctx.principal) {
      throw new Retry("the invitation delivery-state identity did not match the immutable intent");
    }

    const body = providerBody(prepared, invitation, args.organization, args.recipientEmail);
    const intent = {
      protocol: "invite.mail/v1",
      invitation,
      organization: args.organization,
      recipientEmail: args.recipientEmail,
      issuedAt: recorded.issuedAt,
      expiresAt: recorded.expiresAt,
      providerBodySha256: hash(body),
      configSha256: prepared.configSha256,
      credentialNamespaceFingerprint: prepared.credentialNamespaceFingerprint,
    } as const;

    const checkGuard = async (historicalUnknown: boolean): Promise<DeliveryState | null> => {
      const nowFingerprints = fingerprints(freezeConfig(config), ctx.secrets.MAIL_API_KEY);
      if (nowFingerprints.configSha256 !== prepared.configSha256
        || nowFingerprints.credentialNamespaceFingerprint !== prepared.credentialNamespaceFingerprint) return park();
      let current: DeliveryState;
      try {
        current = deliveryState(authoritativeData(await ctx.query(operations.invitationDeliveryState, {
          invitation,
        }), "invitation delivery-state guard"));
      } catch (error) {
        if (historicalUnknown) return park();
        throw error;
      }
      const identityMatches = current.id === invitation && current.organization === args.organization
        && current.recipientEmail === args.recipientEmail && current.issuer === ctx.principal
        && current.issuedAt === recorded.issuedAt && current.expiresAt === recorded.expiresAt;
      const active = identityMatches && current.status === "pending" && current.serverNow < current.expiresAt
        && current.serverNow >= current.issuedAt
        && current.serverNow - current.issuedAt <= RECONCILIATION_HORIZON_MS;
      if (!active) {
        if (historicalUnknown) return park();
        return null;
      }
      return current;
    };

    const send = async (key: string, historicalUnknown: boolean) => {
      const current = await checkGuard(historicalUnknown);
      if (current === null) return { delivery: "not-sent" as const, providerMessageId: null };
      let sent;
      try {
        sent = await sendResendEmail({
          apiKey: ctx.secrets.MAIL_API_KEY,
          idempotencyKey: key,
          body,
          signal: ctx.invocation.signal,
          ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}),
        });
      } catch (error) {
        if (error instanceof ResendUnresolved) return park();
        throw error;
      }
      if (sent.kind === "rejected") {
        if (historicalUnknown) return park();
        return { delivery: "not-sent" as const, providerMessageId: null };
      }
      return { delivery: "accepted" as const, providerMessageId: sent.providerMessageId };
    };

    const delivered = await ctx.step("invite.mail/v1", intent,
      key => send(key, false), { reconcile: key => send(key, true) });
    return { invitation, delivery: delivered.delivery, providerMessageId: delivered.providerMessageId };
  };
}
