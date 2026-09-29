import { admissionCapture } from "./admission.ts";
import type { DeviceCore } from "./local-device.ts";
import type { Queued } from "./local-types.ts";
import { IdentityAdmissions, IDENTITY_ADMISSIONS } from "./identity-admission.ts";
import { runJournalAsync } from "./web-journal-execution.ts";

// Native writes already have asynchronous SQLite custody. Use the same
// pre-identity handoff as the web journal, without a browser storage boundary.
export function nativeAdmission(core: DeviceCore): DeviceCore {
  if (core[admissionCapture]) return core;
  const listeners = new Set<(floor?: number) => void>();
  const pending = new IdentityAdmissions(() => { for (const notify of listeners) notify(); });
  let chain: Promise<unknown> = Promise.resolve();
  let expected: string | null = null;
  const conflict = new Error("another native owner changed deferred custody");
  const invoke = async (request: Record<string, unknown>) => {
    const saving = request.op === "set_meta" && request.key === IDENTITY_ADMISSIONS;
    const reply = await core.call(saving ? { op: "compare_identity_admissions", expected, value: request.value } : request);
    if (saving && !reply.denied && reply.ok === false) throw conflict;
    if (!reply.denied && saving) { expected = request.value as string; pending.remember(expected); }
    if (!reply.denied && request.op === "meta" && request.key === IDENTITY_ADMISSIONS) { expected = reply.ok as string | null; pending.remember(expected); }
    return reply;
  };
  return {
    ...core,
    onOutbox(listener) { listeners.add(listener); const stop = core.onOutbox?.(listener); return () => { listeners.delete(listener); stop?.(); }; },
    call(request, committed) {
      if (!["admit", "queued", "settle", "dequeue", "apply", "observe_store", "adopt"].includes(String(request.op))) return core.call(request, committed);
      const work = chain.then(async () => {
        for (;;) {
        try {
        const reply = request.op === "admit" ? await runJournalAsync(pending.admit(request.entry as Queued, undefined, request.expected_store as string | undefined), invoke)
          : request.op === "queued" ? await runJournalAsync(pending.queued(), invoke)
          : request.op === "settle" || request.op === "dequeue" ? await runJournalAsync(pending.settle(request), invoke)
          : await core.call(request);
        committed?.(reply);
        return reply;
        } catch (error) { if (error !== conflict) throw error; }
        }
      });
      chain = work.catch(() => {});
      return work;
    },
    async close() { pending.close(); listeners.clear(); await chain; await core.close(); },
  };
}
