import {
  decodeDeliveryEnvelopeV1,
  expandDeliveryData,
  type DeliveryEnvelopeV1,
  type ResumeRequestV1,
} from "./offline-protocol.js";
import {
  canonicalAnswerKey,
  type Coverage,
  type HeldAnswer,
  type RangeStore,
  type RetentionPolicy,
  type RowRef,
  type StoreDelivery,
  type WatermarkRecord,
} from "./store/range-store.js";
import type { Manifest, OfflineClientOptions } from "./types.js";

export interface MountedQuery {
  op: string;
  args: unknown;
  drain: boolean;
}

export interface AcceptedDelivery<Result> {
  result: {
    state: "complete" | "capped" | "partial" | "denied";
    data?: Result;
    next?: string | null;
    seq: number;
    reason?: string;
    rule?: string;
  };
  envelope?: DeliveryEnvelopeV1;
}

interface ResumeFacts {
  generation: string;
  schemaHash: string;
  authEpoch: number;
}

export class OfflineRuntime {
  readonly store: RangeStore;
  readonly fenceDays: number;
  readonly maxAssetBytes: number;
  private partition?: string;
  private retention: Record<string, RetentionPolicy> = {};
  private facts?: ResumeFacts;
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly options: OfflineClientOptions) {
    this.store = options.store();
    this.fenceDays = options.fenceDays ?? 7;
    this.maxAssetBytes = options.maxAssetBytes ?? 256 * 1024 * 1024;
  }

  get principal(): string | undefined { return this.partition; }

  async open(principal: string): Promise<void> {
    await this.serial(async () => {
      if (this.partition !== undefined && this.partition !== principal) {
        await this.store.wipe(this.partition);
      }
      await this.store.open(principal);
      this.partition = principal;
      const coverage = await this.store.coverage();
      const watermark = coverage.watermarks.sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (watermark?.generation && watermark.schemaHash && watermark.authEpoch !== undefined) {
        this.facts = {
          generation: watermark.generation,
          schemaHash: watermark.schemaHash,
          authEpoch: watermark.authEpoch,
        };
      }
    });
  }

  async seal(): Promise<void> {
    if (this.partition === undefined) return;
    await this.serial(() => this.store.seal());
  }

  async wipe(): Promise<void> {
    await this.serial(async () => {
      if (this.partition === undefined) return;
      const partition = this.partition;
      this.partition = undefined;
      this.facts = undefined;
      await this.store.wipe(partition);
    });
  }

  async close(): Promise<void> {
    await this.tail;
    await this.store.close?.();
  }

  manifest(value: Manifest): void {
    const tables = value.tables ?? value.schema?.tables ?? {};
    const retention: Record<string, RetentionPolicy> = {};
    for (const [name, table] of Object.entries(tables)) {
      if (table && typeof table === "object") {
        const word = (table as { retain?: unknown }).retain;
        if (word === "until-revoked" || word === "delivered-history") retention[name] = word;
      }
    }
    this.retention = retention;
  }

  accept<Result>(op: string, args: unknown, raw: unknown): AcceptedDelivery<Result> {
    const envelope = decodeDeliveryEnvelopeV1(raw);
    if (!envelope) return { result: raw as AcceptedDelivery<Result>["result"] };
    const result: AcceptedDelivery<Result>["result"] = {
      state: envelope.state,
      ...(envelope.state === "denied" ? {} : { data: expandDeliveryData(envelope) as Result }),
      ...(envelope.state === "complete" || envelope.state === "capped" ? { next: envelope.next } : {}),
      seq: envelope.seq,
      ...(envelope.reason === undefined ? {} : { reason: envelope.reason }),
      ...(envelope.rule === undefined ? {} : { rule: envelope.rule }),
    };
    return { result, envelope };
  }

  async commit(op: string, args: unknown, accepted: AcceptedDelivery<unknown>): Promise<void> {
    await this.commitMany([{ op, args, accepted }]);
  }

  async commitMany(items: Array<{ op: string; args: unknown; accepted: AcceptedDelivery<unknown> }>): Promise<void> {
    if (items.length === 0) return;
    if (this.partition === undefined) {
      const principal = items.find((item) => item.accepted.envelope)?.accepted.envelope?.authority.principal;
      if (!principal) return;
      await this.open(principal);
    }
    const deliveries: StoreDelivery[] = [];
    const tombstones: RowRef[] = [];
    for (const { op, args, accepted } of items) {
      const envelope = accepted.envelope;
      if (envelope) {
        this.facts = {
          generation: envelope.generation,
          schemaHash: envelope.schemaHash,
          authEpoch: envelope.authority.authEpoch,
        };
      }
      const source = envelope ?? accepted.result;
      deliveries.push({
        op,
        args,
        state: source.state,
        ...(source.data === undefined ? {} : { data: source.data }),
        ...(source.next === undefined ? {} : { next: source.next }),
        seq: source.seq,
        ...(envelope?.validator === undefined ? {} : { validator: envelope.validator }),
        ...(envelope?.receipt === undefined ? {} : { receipt: envelope.receipt }),
        ...(envelope?.rows === undefined ? {} : { rows: envelope.rows }),
        ...("reason" in source && typeof source.reason === "string" ? { reason: source.reason } : {}),
        ...("rule" in source && typeof source.rule === "string" ? { rule: source.rule } : {}),
        deliveredAt: Date.now(),
      });
      tombstones.push(...(envelope?.rows.flatMap((row) => this.options.onTombstone?.(row) ?? []) ?? []));
    }
    await this.store.commit({ deliveries, tombstones, retention: this.retention });
  }

  async answer<Result>(op: string, args: unknown): Promise<HeldAnswer<Result> | undefined> {
    if (this.partition === undefined) return undefined;
    return this.store.answer<Result>(op, args);
  }

  async markWatermark(
    op: string,
    args: unknown,
    watermark: string | null,
    validator?: string,
  ): Promise<void> {
    if (this.partition === undefined) return;
    const record: WatermarkRecord = {
      op,
      args,
      watermark,
      ...(validator === undefined ? {} : { validator }),
      ...(this.facts?.generation === undefined ? {} : { generation: this.facts.generation }),
      ...(this.facts?.schemaHash === undefined ? {} : { schemaHash: this.facts.schemaHash }),
      ...(this.facts?.authEpoch === undefined ? {} : { authEpoch: this.facts.authEpoch }),
      updatedAt: Date.now(),
    };
    await this.store.commit({ watermark: record });
  }

  async resumeRequest(mounted: MountedQuery[]): Promise<ResumeRequestV1 | undefined> {
    if (this.partition === undefined || !this.facts) return undefined;
    const coverage = await this.store.coverage();
    const watermark = coverage.watermarks.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const mountedAnswers = (await Promise.all(mounted.slice(0, 32).map(async (query) => ({
      query,
      answer: await this.store.answer(query.op, query.args),
    })))).filter((item): item is { query: MountedQuery; answer: HeldAnswer & { validator: string } } =>
      typeof item.answer?.validator === "string");
    return {
      protocol: 1,
      ...this.facts,
      ...(watermark ? {
        log: {
          op: watermark.op,
          args: watermark.args,
          watermark: watermark.watermark,
          ...(watermark.validator === undefined ? {} : { validator: watermark.validator }),
        },
      } : {}),
      mounted: mountedAnswers.map(({ query, answer }) => ({
        op: query.op,
        args: query.args,
        validator: answer.validator,
      })),
    };
  }

  async resetCoverage(): Promise<void> {
    if (this.partition !== undefined) await this.store.commit({ resetCoverage: true });
  }

  async dropOldestUnmounted(mounted: MountedQuery[], count: number): Promise<void> {
    if (this.partition === undefined) return;
    const coverage = await this.store.coverage();
    await this.store.commit({
      dropOldestUnmounted: {
        mounted: [
          ...mounted.map((query) => canonicalAnswerKey(query.op, query.args)),
          ...coverage.watermarks.map((watermark) => canonicalAnswerKey(watermark.op, watermark.args)),
        ],
        count,
      },
    });
  }

  async coverage(): Promise<Coverage | undefined> {
    return this.partition === undefined ? undefined : this.store.coverage();
  }

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const run = this.tail.then(action);
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }
}

export function offlineView<Result>(held: HeldAnswer<Result> | undefined): any {
  if (!held) return { state: "hydrating", live: false, connection: "offline" };
  const {
    op: _op,
    args: _args,
    receipt: _receipt,
    validator: _validator,
    deliveredAt,
    ...answer
  } = held;
  return {
    ...answer,
    live: false,
    connection: "offline",
    stale: { since: deliveredAt },
  };
}

export function tombstoneRefs(value: unknown): RowRef[] {
  return Array.isArray(value) ? value.filter((item): item is RowRef =>
    !!item && typeof item === "object" && typeof item.table === "string" && typeof item.id === "string") : [];
}
