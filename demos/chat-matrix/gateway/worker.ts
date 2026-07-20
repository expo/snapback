// The AI worker for backends that have no server-side function runtime of
// their own (Supabase, SQLite): polls for pending assistant rows, claims one,
// streams the OpenRouter completion into it via throttled applyDelta writes.
// Snapback and Convex do this inside their own action runtimes instead.

import { streamCompletion } from './openrouter.ts';

const DELTA_INTERVAL_MS = 350;
const POLL_INTERVAL_MS = 400;

export interface WorkerAdapter {
  backend: string;
  claimPending(): Promise<{ messageId: string; model: string; history: { role: string; content: string }[] } | null>;
  applyDelta(messageId: string, content: string, status: string): Promise<void>;
}

export function startAiWorker(adapters: WorkerAdapter[]) {
  let stopped = false;
  const loop = async () => {
    while (!stopped) {
      let worked = false;
      for (const adapter of adapters) {
        try {
          const claim = await adapter.claimPending();
          if (!claim) continue;
          worked = true;
          console.log(`[chat-matrix] ${adapter.backend}: generating with ${claim.model} (${claim.messageId})`);
          let lastCommitAt = 0;
          try {
            const finalText = await streamCompletion(claim.model, claim.history, async (accumulated) => {
              const now = Date.now();
              if (now - lastCommitAt >= DELTA_INTERVAL_MS) {
                lastCommitAt = now;
                await adapter.applyDelta(claim.messageId, accumulated, 'streaming');
              }
            });
            await adapter.applyDelta(claim.messageId, finalText.length > 0 ? finalText : '(empty reply)', 'complete');
          } catch (error) {
            await adapter.applyDelta(claim.messageId, `(generation failed: ${String((error as Error).message ?? error)})`, 'error');
          }
        } catch (error) {
          console.error(`[chat-matrix] ${adapter.backend} worker error:`, error);
        }
      }
      if (!worked) await new Promise((resolveSleep) => setTimeout(resolveSleep, POLL_INTERVAL_MS));
    }
  };
  const done = loop();
  return { stop: async () => { stopped = true; await done; } };
}
