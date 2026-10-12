import { recoverUploadHistory } from "./web-upload-admission.ts";
import type { Persistence, Change } from "./web.ts";
import type { AdmissionAuthorityContext } from "./admission-authority.ts";
import { AdmissionJournal, journalStores, journalStoreBinding } from "./web-journal.ts";
import { claimStore } from "./web-ownership.ts";
import { shareReceipts } from "./web-receipts.ts";
import { WebWorkerHost, type WorkerTransaction } from "./web-worker-host.ts";
import type { Queued } from "./local-types.ts";

// @ref LLP 3000.007#20.4 — orphan outboxes move only under both exclusive
// claims, with shared receipts committed before source deletion. Source rows
// are restored only in its Worker and never copied to the destination/page.
export async function adoptWorkerOrphans(tx: WorkerTransaction, name: string, own: string, persist: Persistence,
  settle: (extra?: Change[]) => Promise<void>, waitForLock: (name: string) => void, authority?: AdmissionAuthorityContext): Promise<boolean> {
  if (!persist.others || !persist.remove) return false;
  const prefix = `${name}:tab-`, stores = new Set(await persist.others(prefix));
  let retry = false;
  for (const orphan of new Set([...stores, ...journalStores(prefix)])) {
    if (orphan === own || !orphan.startsWith(prefix)) continue;
    const claim = await claimStore(persist, orphan, false);
    if (!claim) { waitForLock(orphan); continue; }
    let source: WebWorkerHost | undefined, dirty = false;
    try {
      if (!stores.has(orphan) && !await persist.has?.(orphan)) continue;
      // Unknown/evicted identity cannot be guessed from a journal key.
      if (!await persist.read?.(orphan, "m", "device:store_id") || !await persist.read?.(orphan, "m", "device:backend")) continue;
      const destination = (await tx.invoke({ op: "sync_state", capture: false })).ok;
      source = new WebWorkerHost({ name: claim.name, async release() {} });
      const journal = new AdmissionJournal(orphan, true);
      journal.authority = authority;
      journal.load(await source.open(null));
      const recovered = await source.transaction(async src => {
        journal.load([...src.journal]);
        let state = (await src.invoke({ op: "sync_state", capture: false })).ok;
        if (state.backend_required && !state.restore_refusal && state.store_id === destination.store_id
          && !destination.backend_required && !destination.restore_refusal) {
          const backend = (await tx.invoke({ op: "backend" })).ok;
          const adopted = await src.invoke({ op: "adopt", backend, store_id: destination.store_id, send_revision: state.send_revision });
          if (adopted.denied) throw new Error(JSON.stringify(adopted));
          journal.remember(await src.commit());
        }
        await journal.recoverWith(src.invoke, async (extra = []) => {
          journal.remember(await src.commit(extra)); journal.cleanup(new Map());
        });
        state = (await src.invoke({ op: "sync_state", capture: false })).ok;
        const entries = (await src.invoke({ op: "queued" })).ok as Queued[];
        const history = (await src.invoke({ op: "meta", key: "write-history" })).ok;
        const saved = await src.commit(); journal.remember(saved);
        return { entries, history, state, markers: [...src.journal, ...saved].filter(c => c.s === "j") };
      });
      if (recovered.history && !await shareReceipts(persist, name, recovered.history)) { waitForLock(`${name}:receipts`); continue; }
      const entries = recovered.entries.sort((a, b) => a.seq - b.seq);
      const destinationEntries=(await tx.invoke({op:"queued"})).ok as Queued[];
      const existing=new Set(destinationEntries.map(e=>e.id)),existingMedia=new Set(destinationEntries.filter(e=>e.upload).map(e=>e.id));
      const transfers = new Map(recovered.markers.filter(c => c.v !== null).map(c => [c.k, JSON.parse(c.v!)]));
      const removed = new Set<string>();
      let unresolved = false;
      for (const entry of entries) {
        const binding = journalStoreBinding(transfers.get(entry.id)?.storeId, destination.store_id);
        if (binding === "defer") { unresolved = true; continue; }
        if (binding === "retire") { removed.add(entry.id); continue; }
        const known = entry.sent_seq != null || entry.observed_seq != null;
        if (known && (!recovered.state.store_id || !destination.store_id)) { unresolved = true; continue; }
        if(entry.upload||existingMedia.has(entry.id)){
          const receipt=await recoverUploadHistory(tx.invoke,persist,name,entry as unknown as Record<string,unknown>);
          if(receipt?.denied){if((receipt.denied as {code?:string}).code==="E_WRITE_ID_REUSE"){unresolved=true;retry=true;break;}throw new Error(JSON.stringify(receipt.denied));}
          if(receipt){removed.add(entry.id);continue;}
        }
        if ((!known || recovered.state.store_id === destination.store_id) && (!existing.has(entry.id)||entry.upload||existingMedia.has(entry.id))) {
          dirty = true;
          const next = await tx.invoke({ op: "next_submission" });
          const reply = await tx.invoke({ op: "enqueue", entry: { ...entry, seq: next.ok ?? entry.seq, predictable: false, predicted: [] } });
          if(["E_UPLOAD_QUOTA","E_WRITE_ID_REUSE"].includes(reply.denied?.code??"")){unresolved=true;retry=true;break;}
          if (reply.denied) throw new Error(JSON.stringify(reply));
          existing.add(entry.id);
        }
        removed.add(entry.id);
      }
      await settle(recovered.markers.filter(c => !entries.some(e => e.id === c.k && !removed.has(e.id))));
      dirty = false;
      if (unresolved || journalStores(prefix).includes(orphan)) {
        await source.transaction(async src => {
          for (const id of removed) await src.invoke({ op: "dequeue", id });
          await src.commit();
        });
      } else {
        // Stop the VM/IDB owner before deleting its store. Keep the page claim
        // until removal finishes so another adopter cannot reopen in between.
        await source.close(); await persist.remove(orphan);
      }
    } catch (error) { if (dirty) throw error; retry = true; }
    finally { if (source) await source.close(); await claim.release(); }
  }
  return retry;
}
