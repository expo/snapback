import { createHash, randomBytes } from "node:crypto";
import type { Mutation, Query, Read } from "snapback4/contract";
import { ParkStep, ServerError, type ServerContext } from "snapback4/server";
import { Retry } from "snapback4/worker";
import { ResendUnresolved, sendResendEmail } from "./resend.ts";

interface AdminSummary {
  readonly seatLimit: number;
  readonly memberCount: number;
  readonly reservationCount: number;
}

interface DeliveryState {
  readonly id: string;
  readonly organization: string;
  readonly recipientEmail: string;
  readonly issuer: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly status: "pending" | "accepted" | "revoked";
  readonly serverNow: number;
}

interface RecordedInvitation {
  readonly protocol: "invite.record/v1";
  readonly id: string;
  readonly organization: string;
  readonly recipientEmail: string;
  readonly issuer: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

interface RecordInvitationArgs {
  readonly id: string;
  readonly organization: string;
  readonly recipientEmail: string;
  readonly tokenHash: string;
}

export interface InvitationIssuanceOperations {
  readonly adminOrganizationSummary: Query<{ readonly organization: string }, AdminSummary>;
  readonly invitationDeliveryState: Query<{ readonly invitation: string }, DeliveryState>;
  readonly organizationRecordInvitation: Mutation<RecordInvitationArgs, unknown>;
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

type MailResult = {
  readonly delivery: "accepted" | "not-sent";
  readonly providerMessageId: string | null;
};

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
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new ServerError("E_SECRET_MISSING", "the declared invitation credential is missing or empty");
  }
  return {
    configSha256: hash(canonical(frozen)),
    credentialNamespaceFingerprint: hash(`snapback4:resend-credential-namespace:v1\0${apiKey}`),
  };
}

function authoritativeData<T>(read: Read<T>, purpose: string): T {
  if (!("data" in read) || read.complete !== true || read.fresh !== true || read.cut !== null
    || read.next !== undefined && read.next !== null) {
    throw new Retry(`the ${purpose} query did not return an authoritative fresh point result`);
  }
  if (read.data === null || read.data === undefined) {
    throw new Retry(`the ${purpose} query returned no authoritative row`);
  }
  return read.data;
}

function validDeliveryState(value: DeliveryState): DeliveryState {
  const row = value as Partial<DeliveryState>;
  for (const name of ["id", "organization", "recipientEmail", "issuer", "status"] as const) {
    if (typeof row[name] !== "string") throw new Retry("the invitation delivery-state result was invalid");
  }
  for (const name of ["issuedAt", "expiresAt", "serverNow"] as const) {
    if (!Number.isSafeInteger(row[name])) throw new Retry("the invitation delivery-state result was invalid");
  }
  if (!(["pending", "accepted", "revoked"] as const).includes(row.status as DeliveryState["status"])) {
    throw new Retry("the invitation delivery-state result was invalid");
  }
  return value;
}

function providerBody(prepared: PreparedInvitation, recorded: RecordedInvitation): string {
  const target = new URL(prepared.frozen.acceptanceBase);
  target.hash = new URLSearchParams({ invitation: recorded.id, token: prepared.rawToken }).toString();
  const link = target.href;
  const text = `You have been invited to organization ${recorded.organization}. Sign in as ${recorded.recipientEmail}, then open ${link}`;
  const htmlLink = link.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return JSON.stringify({
    from: prepared.frozen.from,
    to: [recorded.recipientEmail],
    subject: prepared.frozen.subject,
    text,
    html: `<p>You have been invited to an organization.</p><p><a href="${htmlLink}">Accept invitation</a></p>`,
  });
}

function park(): never {
  throw new ParkStep("the invitation delivery outcome needs operator reconciliation");
}

// @ref LLP 3000.009#5.2 — prepare and record complete before provider work; uncertain delivery reuses one key or parks.
// @ref LLP 3000.009#7 — identity provider protocol stays in the optional application server adapter.
export function invitationIssuanceHandler(
  operations: InvitationIssuanceOperations,
  config: InvitationIssuanceConfig,
  dependencies: { readonly fetch?: typeof fetch } = {},
) {
  return async function issueInvitation(
    args: { readonly organization: string; readonly recipientEmail: string },
    ctx: ServerContext<"MAIL_API_KEY">,
  ): Promise<{ invitation: string; delivery: "accepted" | "not-sent"; providerMessageId: string | null }> {
    if (typeof args.organization !== "string" || typeof args.recipientEmail !== "string"
      || args.recipientEmail.length < 1 || args.recipientEmail.length > 320 || args.recipientEmail.trim() !== args.recipientEmail) {
      throw new ServerError("E_INVITATION_INPUT", "the invitation arguments are invalid");
    }

    // The callback is the only place that preflights current admin authority
    // and reads live configuration before randomness. A completed prepare
    // receipt replays without either read.
    const prepare = async (): Promise<PreparedInvitation> => {
      authoritativeData(await ctx.query(operations.adminOrganizationSummary, {
        organization: args.organization,
      }), "organization-admin preflight");
      const frozen = freezeConfig(config);
      const frozenFingerprints = fingerprints(frozen, ctx.secrets.MAIL_API_KEY);
      const rawToken = randomBytes(32).toString("base64url");
      return {
        protocol: "invite.prepare/v1",
        rawToken,
        tokenHash: hash(rawToken),
        ...frozenFingerprints,
        frozen,
      };
    };
    const prepared = await ctx.step("invite.prepare/v1", {
      protocol: "invite.prepare/v1",
      organization: args.organization,
      recipientEmail: args.recipientEmail,
    }, prepare, { reconcile: prepare });

    const invitation = ctx.writeIdFor("invite.entity/v1");
    const recordArgs = {
      id: invitation,
      organization: args.organization,
      recipientEmail: args.recipientEmail,
      tokenHash: prepared.tokenHash,
    } as const;
    const record = async (): Promise<RecordedInvitation> => {
      let written;
      try {
        written = await ctx.mutate(operations.organizationRecordInvitation, recordArgs, {
          id: ctx.writeIdFor("invite.record.write/v1"),
        });
      } catch {
        throw new Retry("the invitation write outcome is uncertain");
      }
      if (written.state === "pending") throw new Retry("the invitation write outcome is uncertain");
      if (written.state !== "sent") throw new ServerError("E_INVITATION_WRITE", "the invitation could not be recorded");

      // Replayed sent writes may omit their old result. Confirm the exact row
      // through the ordinary current-admin point query instead.
      const row = validDeliveryState(authoritativeData(await ctx.query(operations.invitationDeliveryState, {
        invitation,
      }), "invitation delivery-state record"));
      if (row.id !== invitation || row.organization !== args.organization
        || row.recipientEmail !== args.recipientEmail || row.issuer !== ctx.principal
        || row.status !== "pending" || row.serverNow < row.issuedAt || row.serverNow >= row.expiresAt) {
        throw new Retry("the recorded invitation did not match the immutable delivery intent");
      }
      return {
        protocol: "invite.record/v1",
        id: row.id,
        organization: row.organization,
        recipientEmail: row.recipientEmail,
        issuer: row.issuer,
        issuedAt: row.issuedAt,
        expiresAt: row.expiresAt,
      };
    };
    const recorded = await ctx.step("invite.record/v1", {
      protocol: "invite.record/v1",
      invitation,
      organization: args.organization,
      recipientEmail: args.recipientEmail,
      tokenHash: prepared.tokenHash,
    }, record, { reconcile: record });

    const body = providerBody(prepared, recorded);
    const intent = {
      protocol: "invite.mail/v1",
      invitation,
      organization: recorded.organization,
      recipientEmail: recorded.recipientEmail,
      issuedAt: recorded.issuedAt,
      expiresAt: recorded.expiresAt,
      providerBodySha256: hash(body),
      configSha256: prepared.configSha256,
      credentialNamespaceFingerprint: prepared.credentialNamespaceFingerprint,
    } as const;

    const checkGuard = async (historicalUnknown: boolean): Promise<DeliveryState | null> => {
      try {
        const currentFrozen = freezeConfig(config);
        const currentFingerprints = fingerprints(currentFrozen, ctx.secrets.MAIL_API_KEY);
        if (currentFingerprints.configSha256 !== prepared.configSha256
          || currentFingerprints.credentialNamespaceFingerprint !== prepared.credentialNamespaceFingerprint) return park();
      } catch (error) {
        if (ctx.invocation.signal.aborted) throw ctx.invocation.signal.reason;
        void error;
        return park();
      }

      let current: DeliveryState;
      try {
        current = validDeliveryState(authoritativeData(await ctx.query(operations.invitationDeliveryState, {
          invitation,
        }), "invitation delivery-state guard"));
      } catch (error) {
        if (ctx.invocation.signal.aborted) throw ctx.invocation.signal.reason;
        if (historicalUnknown) return park();
        throw error;
      }
      const identityMatches = current.id === recorded.id && current.organization === recorded.organization
        && current.recipientEmail === recorded.recipientEmail && current.issuer === recorded.issuer
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

    const send = async (key: string, historicalUnknown: boolean): Promise<MailResult> => {
      const current = await checkGuard(historicalUnknown);
      if (current === null) return { delivery: "not-sent", providerMessageId: null };
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
        return { delivery: "not-sent", providerMessageId: null };
      }
      return { delivery: "accepted", providerMessageId: sent.providerMessageId };
    };

    const delivered = await ctx.step("invite.mail/v1", intent,
      key => send(key, false), { reconcile: key => send(key, true) });
    return { invitation, delivery: delivered.delivery, providerMessageId: delivered.providerMessageId };
  };
}
