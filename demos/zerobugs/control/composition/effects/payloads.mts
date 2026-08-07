import {signUnsubscribeToken} from '../lib/tokens.mts';

export type IntentSnapshot = Readonly<{
  physicalID: string;
  idempotencyKey: string;
  trigger: string;
  kind: string;
  issueID: string;
  created: number;
  payloadSnapshot: string;
  recipientSnapshot: string;
  discordEligible: boolean;
}>;

type NotificationPayload = {
  kind: string;
  actor: {id: string; login: string};
  issue: {
    id: string;
    shortID: number | null;
    title: string;
    description: string;
    visibility: 'public' | 'internal';
  };
  update?: Record<string, unknown>;
  emoji?: string;
  comment?: {id: string; body: string};
};

type RecipientSnapshot = {
  actorSourceUserID: string;
  includeActor: boolean;
  issueVisibility: 'public' | 'internal';
  issueShortID: number | null;
  recipients: Array<{sourceUserID: string; email: string}>;
  discordEligible: boolean;
};

export type RenderedDelivery = Readonly<{
  channel: 'email' | 'discord';
  recipientKey: string;
  provider: 'loops' | 'discord';
  idempotencyKey: string;
  body: Record<string, unknown>;
}>;

function boundedText(value: unknown, label: string, limit = 8_192): string {
  if (typeof value !== 'string' || value.length > limit) {
    throw new TypeError(`${label} is not a bounded string`);
  }
  return value;
}

function clip(value: string, limit = 280): string {
  const normalized = value.trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`;
}

function parseSnapshots(intent: IntentSnapshot): {
  payload: NotificationPayload;
  recipients: RecipientSnapshot;
} {
  const payload = JSON.parse(intent.payloadSnapshot) as NotificationPayload;
  const recipients = JSON.parse(intent.recipientSnapshot) as RecipientSnapshot;
  if (
    !payload || !payload.actor || !payload.issue
    || payload.kind !== intent.kind
    || !recipients || !Array.isArray(recipients.recipients)
    || recipients.recipients.length > 1_023
    || recipients.discordEligible !== intent.discordEligible
  ) throw new TypeError('notification intent snapshots are inconsistent');
  boundedText(payload.actor.login, 'actor login', 256);
  boundedText(payload.issue.id, 'issue id', 256);
  boundedText(payload.issue.title, 'issue title');
  boundedText(payload.issue.description, 'issue description', 64 * 1_024);
  return {payload, recipients};
}

function titleFor(payload: NotificationPayload): string {
  switch (payload.kind) {
    case 'create-issue': return `${payload.actor.login} reported an issue`;
    case 'update-issue': return `${payload.actor.login} updated an issue`;
    case 'add-emoji-to-issue': return `${payload.actor.login} reacted to an issue`;
    case 'add-emoji-to-comment': return `${payload.actor.login} reacted to a comment`;
    case 'add-comment': return `${payload.actor.login} commented on an issue`;
    case 'edit-comment': return `${payload.actor.login} edited a comment`;
    default: throw new TypeError('notification kind is not deliverable');
  }
}

function messageFor(payload: NotificationPayload): string {
  switch (payload.kind) {
    case 'create-issue':
      return `${payload.issue.title}\n\n${clip(payload.issue.description)}`.trim();
    case 'update-issue': {
      const changes = Object.entries(payload.update ?? {})
        .filter(([key]) => key !== 'id')
        .map(([key, value]) => `${key}: ${String(value)}`);
      return [payload.issue.title, ...changes, clip(payload.issue.description)].filter(Boolean).join('\n');
    }
    case 'add-emoji-to-issue':
      return `${payload.issue.title}\n${boundedText(payload.emoji, 'emoji', 64)}`;
    case 'add-emoji-to-comment':
      return `${clip(boundedText(payload.comment?.body, 'comment body', 64 * 1_024))}\n${boundedText(payload.emoji, 'emoji', 64)}`;
    case 'add-comment':
    case 'edit-comment':
      return `${payload.issue.title}\n${clip(boundedText(payload.comment?.body, 'comment body', 64 * 1_024))}`;
    default:
      throw new TypeError('notification kind is not deliverable');
  }
}

function attachmentsFrom(message: string): Array<{url: string}> {
  const attachments: Array<{url: string}> = [];
  const pattern = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/gu;
  for (const match of message.matchAll(pattern)) {
    if (attachments.length === 32) break;
    attachments.push({url: match[1]});
  }
  return attachments;
}

export function renderIntentDeliveries(intent: IntentSnapshot, options: Readonly<{
  publicOrigin: string;
  unsubscribeSecret: string;
  loopsTransactionalID: string;
  expiresAt: number;
}>): RenderedDelivery[] {
  const {payload, recipients} = parseSnapshots(intent);
  const settlementPrefix = `notification:${intent.trigger}:`;
  if (!intent.idempotencyKey.startsWith(settlementPrefix)) {
    throw new TypeError('notification settlement identity is invalid');
  }
  const settlementIdentity = intent.idempotencyKey.slice(settlementPrefix.length);
  if (!settlementIdentity || settlementIdentity.length > 768) {
    throw new TypeError('notification settlement identity is invalid');
  }
  const shortID = payload.issue.shortID;
  if (!Number.isSafeInteger(shortID) || (shortID as number) < 1) {
    throw new TypeError('notification issue requires a positive short id');
  }
  const origin = options.publicOrigin.replace(/\/$/u, '');
  if (!/^http:\/\/(127\.0\.0\.1|localhost):[0-9]{1,5}$/u.test(origin)) {
    throw new TypeError('Lane 5 delivery origin must be loopback');
  }
  const baseLink = `${origin}/p/zero/issue/${shortID}.md`;
  const link = (payload.kind === 'add-comment' || payload.kind === 'edit-comment')
    ? `${baseLink}#comment-${encodeURIComponent(boundedText(payload.comment?.id, 'comment id', 256))}`
    : baseLink;
  const title = titleFor(payload);
  const message = messageFor(payload);
  const threadID = `<zerobugs-issue-${payload.issue.id}@zerobugs-control.local>`;
  const subject = clip(`#${shortID} ${payload.issue.title}`, 160);
  const deliveries: RenderedDelivery[] = [];
  for (const recipient of recipients.recipients) {
    const email = boundedText(recipient.email, 'recipient email', 320).trim();
    const sourceUserID = boundedText(recipient.sourceUserID, 'recipient source user id', 256);
    const unsubscribeToken = signUnsubscribeToken({
      user: sourceUserID,
      issue: payload.issue.id,
      exp: options.expiresAt,
    }, options.unsubscribeSecret);
    deliveries.push({
      channel: 'email',
      recipientKey: email,
      provider: 'loops',
      idempotencyKey: `${settlementIdentity}:${email}`,
      body: {
        email,
        transactionalId: options.loopsTransactionalID,
        addToAudience: true,
        dataVariables: {
          title,
          subject,
          message,
          link,
          unsubscribe: `${origin}/api/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`,
          attachments: attachmentsFrom(message),
          'Message-ID': threadID,
          'In-Reply-To': threadID,
          References: threadID,
        },
      },
    });
  }
  if (intent.discordEligible) {
    deliveries.push({
      channel: 'discord',
      recipientKey: 'project-webhook',
      provider: 'discord',
      idempotencyKey: `${settlementIdentity}:discord`,
      body: {content: `**${title}**\n${message}\n<${link}>`},
    });
  }
  return deliveries;
}
