// @ref LLP 3000.038.000#2 — binary admission uses the authoritative session lock through IDB commit, without a localStorage payload.
import type { AdmissionAuthority, AdmissionAuthorityContext } from "./admission-authority.ts";
import { sameAdmissionAuthority, admissionAuthorityRefusal } from "./admission-authority.ts";
import { storeLock } from "./app-storage.ts";
import { receiptHistory, type TerminalReceipt } from "./web-receipts.ts";
import type { Persistence } from "./web.ts";
export function captureUploadAuthority(request: Record<string, unknown>, context?: AdmissionAuthorityContext): AdmissionAuthority | undefined {
  return request.op === "admit_upload" ? context?.capture() : undefined;
}
export async function authorizeUpload(stamp: AdmissionAuthority, context: AdmissionAuthorityContext, viewer: string, execute: () => Promise<Record<string, unknown>>) {
  return await storeLock(stamp.key, async () => {
    if (!await sameAdmissionAuthority(stamp, context, viewer)) { context.recheck(); return { denied: admissionAuthorityRefusal() }; }
    return await execute();
  });
}
export async function recoverUploadHistory(invoke: (request: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>, persist: Persistence, name: string, entry: Record<string, unknown>, protectedHistory?: readonly TerminalReceipt[]) {
  const shared = await receiptHistory(persist, name);
  const candidates=[...(protectedHistory??[]),...shared].filter(write=>write.id===entry.id);
  let result:Record<string,unknown>|undefined;
  for(const known of candidates){
    const reply=await invoke({op:"check_upload_receipt",entry,write:known});
    if(reply.denied)return reply;
    result={ok:{write:reply.ok}};
  }
  return result;
}

/** Protect applicable ownership before opening/orphan recovery can trim its shared window. */
export async function preflightUpload(entry: Record<string, unknown>, invoke: (request: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>, persist: Persistence, name: string,
  stamp?: AdmissionAuthority, context?: AdmissionAuthorityContext): Promise<Record<string, unknown>> {
  const check=async()=>await recoverUploadHistory(invoke,persist,name,entry)??{continue_upload:true};
  return stamp&&context?await authorizeUpload(stamp,context,String(entry.viewer??""),check):await check();
}
