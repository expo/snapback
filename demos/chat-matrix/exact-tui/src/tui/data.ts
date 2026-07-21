// Pure data module for the Exact TUI chat cell. The TUI runtime is offline by
// design (LLP 0368 — no network host call), so the "assistant" here is a
// scripted local reply that states the boundary instead of pretending to be
// the real AI loop the other seven chat-matrix cells run.

export function appendExchange(lines: string[], backend: string, content: string): string[] {
  if (content.length === 0) return lines;
  return [
    ...lines,
    `you  ${content}`,
    `ai   [offline] The Exact TUI runtime has no network host call yet, so I cannot reach the ${backend} backend. Every other chat-matrix cell answers this via OpenRouter.`,
  ];
}

export function backendTabs(): { id: string; label: string; disabled: boolean }[] {
  return ['snapback', 'convex', 'supabase', 'sqlite'].map((id) => ({
    id,
    label: id,
    disabled: false,
  }));
}
