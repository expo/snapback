// Journal plans run synchronously on the default VM or asynchronously across
// a Worker boundary. They do not capture, clean localStorage, authorize or
// commit: those responsibilities stay with the page's exclusive owner.
export interface JournalDevice { call(request: string): string }
// The wasm ABI is a JSON envelope. Its payload is decoded by each plan.
export type JournalReply = { ok?: any; denied?: any };
export type JournalInvoke = (request: Record<string, unknown>) => Promise<JournalReply>;
export type JournalPlan<T> = Generator<Record<string, unknown>, T, JournalReply>;

export function runJournal<T>(plan: JournalPlan<T>, call: (request: Record<string, unknown>) => JournalReply): T {
  let step = plan.next();
  try {
    while (!step.done) step = plan.next(call(step.value));
    return step.value;
  } finally { if (!step.done) plan.return(undefined as T); }
}

export async function runJournalAsync<T>(plan: JournalPlan<T>, call: JournalInvoke): Promise<T> {
  let step = plan.next();
  try {
    while (!step.done) step = plan.next(await call(step.value));
    return step.value;
  } finally { if (!step.done) plan.return(undefined as T); }
}
