// The shared online-only action transport. It never enters the outbox or
// interpreter; an uncertain response keeps the client's retry id visible.
import type { Act, Action, ActOptions, Refusal } from "./contract.ts";

export type ActionPost = (path: string, body: unknown) => Promise<{ ok: false } | { ok: true; json: Record<string, unknown> }>;

export async function act<A, R>(op: Action<A, R>, args: A, options: ActOptions | undefined, id: string, post: ActionPost, unavailable: () => Refusal | undefined): Promise<Act<R>> {
  const denied = unavailable();
  if (denied) return { denied, id };
  if (op.kind !== "action") return { denied: { code: "E_ACTION_UNKNOWN", family: "action", message: "act takes an Action from the generated api" }, id };
  // Distinguish a bad input before submitting it; a network failure after
  // submission cannot establish whether the server admitted the request.
  try { JSON.stringify({ id, args }); }
  catch { return { denied: { code: "E_INPUT", family: "input", message: "action arguments must be JSON-serializable" }, id }; }
  const wait = options?.waitSeconds;
  const query = wait == null ? "" : `?wait=${Math.max(0, Math.min(25, Math.floor(Number.isFinite(wait) ? wait : 25)))}`;
  const reply = await post(`/a/${encodeURIComponent(op.name)}${query}`, { id, args });
  const ended = unavailable();
  if (ended && ended.code !== "E_OFFLINE") return { denied: ended, id };
  if (!reply.ok) return { state: "pending", id };
  const json = reply.json;
  if (json.denied) return { denied: json.denied as Refusal, id };
  if (json.id === id) {
    if (json.state === "done" && "result" in json) return { state: "done", id, result: json.result as R };
    if (json.state === "failed" && json.why) return { state: "failed", id, why: json.why as Refusal };
    if (json.state === "pending") return { state: "pending", id };
  }
  return { state: "pending", id };
}
