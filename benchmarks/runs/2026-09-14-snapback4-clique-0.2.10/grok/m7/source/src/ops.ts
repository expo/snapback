import type { Client, Mutation, Write } from "snapback4/contract";

export function isLocal(client: Client): client is Client & {
  onWrite(notify: (write: Write<unknown>) => void): () => void;
} {
  return typeof (client as { onWrite?: unknown }).onWrite === "function";
}

export async function settle<A, R>(client: Client, op: Mutation<A, R>, args: A): Promise<Write<R>> {
  const write = await client.mutate(op, args);
  if (write.state !== "pending") return write;
  if (!isLocal(client)) return write;
  return await new Promise((resolve) => {
    const off = client.onWrite((next) => {
      if (next.id !== write.id) return;
      if (next.state === "pending") return;
      off();
      resolve(next as Write<R>);
    });
  });
}

export function refusalMessage(write: Write<unknown>): string | null {
  if (write.state !== "failed") return null;
  return write.why.rule ?? write.why.message ?? write.why.code;
}

export function handleFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "user";
  const cleaned = local.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 20);
  if (cleaned.length >= 3) return cleaned;
  return `${cleaned}user`.slice(0, 20);
}

export function groupSlug(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function dmPairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function countOf(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "value" in (value as { value?: unknown })) {
    const inner = (value as { value?: unknown }).value;
    if (typeof inner === "number" && Number.isFinite(inner)) return inner;
  }
  if (Array.isArray(value)) return value.length;
  return 0;
}

export function formatTime(ms: number | null | undefined): string {
  if (ms == null) return "";
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
