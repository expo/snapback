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
  let identified = false, empty = false, store: string | undefined, protocolChecked = false;
  const conflict = new Error("another native owner changed deferred custody");
  const remember = (value: string | null) => { pending.remember(value); empty = !value || JSON.parse(value).length === 0; };
  const attempt = () => {
    // The compare token belongs to this plan, never to an overlapping state read.
    let expected: string | null = null;
    return async (request: Record<string, unknown>, committed?: Parameters<DeviceCore["call"]>[1]) => {
      const saving = request.op === "set_meta" && request.key === IDENTITY_ADMISSIONS;
      const reply = await core.call(saving ? { op: "compare_identity_admissions", expected, value: request.value } : request, committed);
      if (saving && !reply.denied && reply.ok === false) throw conflict;
      if (saving && reply.denied) throw reply;
      if (!reply.denied && saving) { expected = request.value as string; remember(expected); }
      if (!reply.denied && request.op === "meta" && request.key === IDENTITY_ADMISSIONS) { expected = reply.ok as string | null; remember(expected); }
      return reply;
    };
  };
  return {
    ...core,
    onOutbox(listener) { listeners.add(listener); const stop = core.onOutbox?.(listener); return () => { listeners.delete(listener); stop?.(); }; },
    call(request, committed) {
      // openLocalDevice's first call is requireSyncProtocol. Its read-only
      // diagnosis must finish before any request from the custody handoff.
      if (request.op === "sync_state" && !protocolChecked) { protocolChecked = true; return core.call(request, committed); }
      const page = request.page as { store_id?: string } | undefined;
      if (request.op === "adopt" || (["apply", "observe_store"].includes(String(request.op)) && page?.store_id !== store)) { identified = false; empty = false; }
      // Once custody has drained, preserve the ordinary native call boundary,
      // including sync-state reads used by query publication. Identity-changing
      // operations above invalidate this shortcut before their commit.
      if (identified && empty) return core.call(request, committed);
      if (request.op === "sync_state") return core.call(request, committed).then(async reply => {
        store = (reply.ok as { store_id?: string } | undefined)?.store_id;
        identified = !!store;
        const metadata = await core.call({ op: "meta", key: IDENTITY_ADMISSIONS });
        if (!metadata.denied) remember(metadata.ok as string | null);
        return reply;
      });
      if (!["admit", "queued", "settle", "dequeue"].includes(String(request.op))) return core.call(request, committed);
      const work = chain.then(async () => {
        let notified = false;
        const notify: NonNullable<Parameters<DeviceCore["call"]>[1]> = reply => { notified = true; committed?.(reply); };
        for (;;) {
          const invoke = attempt();
          const planCall = (next: Record<string, unknown>) => invoke(next, request.op === next.op ? notify : undefined);
          try {
            const reply = request.op === "admit" ? await runJournalAsync(pending.admit(request.entry as Queued, undefined, request.expected_store as string | undefined), planCall)
              : request.op === "queued" ? await runJournalAsync(pending.queued(request), planCall)
              : request.op === "settle" || request.op === "dequeue" ? await runJournalAsync(pending.settle(request), planCall)
              : await core.call(request, notify);
            if (!notified) notify(reply);
            return reply;
          } catch (error) {
            if (error === conflict) continue;
            if (error && typeof error === "object" && "denied" in error) {
              const reply = error as Awaited<ReturnType<DeviceCore["call"]>>;
              if (!notified) notify(reply);
              return reply;
            }
            throw error;
          }
        }
      });
      chain = work.catch(() => {});
      return work;
    },
    async close() { pending.close(); listeners.clear(); await chain; await core.close(); },
  };
}
