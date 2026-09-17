const RAW_EVENT_CONTEXT = Symbol("social-messenger.raw-event-context");
const RAW_EXCERPT_LIMIT = 512;

function boundedExcerpt(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined) return "<not event-scoped>";
  if (text.length <= RAW_EXCERPT_LIMIT) return text;
  return `${text.slice(0, RAW_EXCERPT_LIMIT)}…<truncated ${text.length - RAW_EXCERPT_LIMIT} chars>`;
}

function inferredEventType(event) {
  if (event === null || typeof event !== "object") return "unparseable";
  const outer = typeof event.type === "string" && event.type.length > 0
    ? event.type
    : "unknown";
  const inner = typeof event.payload?.type === "string" && event.payload.type.length > 0
    ? event.payload.type
    : null;
  return inner === null || inner === outer ? outer : `${outer}/${inner}`;
}

export function retainRawEventContext(event, { source, streamLine, rawPayload }) {
  if (event === null || typeof event !== "object") return event;
  Object.defineProperty(event, RAW_EVENT_CONTEXT, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      source,
      streamLine,
      eventOrdinal: Number.isInteger(event.ordinal) ? event.ordinal : streamLine,
      eventType: inferredEventType(event),
      rawPayload,
    }),
  });
  return event;
}

export function rawEventContext(event) {
  return event?.[RAW_EVENT_CONTEXT] ?? null;
}

export class FinalizationDiagnosticError extends Error {
  constructor(cause, {
    stage,
    event = null,
    source = null,
    streamLine = null,
    eventOrdinal = null,
    eventType = null,
    rawPayload = null,
  } = {}) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "FinalizationDiagnosticError";
    const retained = rawEventContext(event);
    this.finalizationDiagnostic = Object.freeze({
      stage,
      source: retained?.source ?? source ?? "none",
      streamLine: retained?.streamLine ?? streamLine,
      eventOrdinal: retained?.eventOrdinal
        ?? eventOrdinal
        ?? (Number.isInteger(event?.ordinal) ? event.ordinal : streamLine),
      eventType: retained?.eventType ?? eventType ?? inferredEventType(event),
      rawPayloadExcerpt: boundedExcerpt(retained?.rawPayload ?? rawPayload),
    });
  }
}

export function withEventDiagnostic(stage, event, operation) {
  try {
    return operation();
  } catch (error) {
    if (error instanceof FinalizationDiagnosticError) throw error;
    throw new FinalizationDiagnosticError(error, { stage, event });
  }
}

export async function withFinalizationStage(stage, operation) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof FinalizationDiagnosticError) {
      throw new FinalizationDiagnosticError(error.cause ?? error, {
        ...error.finalizationDiagnostic,
        stage: `${stage}/${error.finalizationDiagnostic.stage}`,
        rawPayload: error.finalizationDiagnostic.rawPayloadExcerpt,
      });
    }
    throw new FinalizationDiagnosticError(error, { stage });
  }
}

function leafErrors(error) {
  if (error instanceof AggregateError) return error.errors.flatMap(leafErrors);
  return [error];
}

export function formatFinalizationFailure(error) {
  return leafErrors(error).map((leaf) => {
    const diagnostic = leaf.finalizationDiagnostic ?? {
      stage: "unclassified",
      source: "none",
      streamLine: null,
      eventOrdinal: null,
      eventType: "unknown",
      rawPayloadExcerpt: "<not event-scoped>",
    };
    return [
      `stage=${diagnostic.stage}`,
      `source=${JSON.stringify(diagnostic.source)}`,
      `streamLine=${diagnostic.streamLine ?? "none"}`,
      `eventOrdinal=${diagnostic.eventOrdinal ?? "none"}`,
      `eventType=${JSON.stringify(diagnostic.eventType)}`,
      `cause=${JSON.stringify(leaf.cause?.message ?? leaf.message)}`,
      `rawPayloadExcerpt=${JSON.stringify(diagnostic.rawPayloadExcerpt)}`,
    ].join(" ");
  }).join("\n");
}

export const FINALIZATION_RAW_EXCERPT_LIMIT = RAW_EXCERPT_LIMIT;
