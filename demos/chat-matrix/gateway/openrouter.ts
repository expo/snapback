// OpenRouter access for the chat matrix. The key never ships in any client
// bundle: only this server-side module reads it, from OPENROUTER_API_KEY or
// the local key file (a labeled two-line file: label, then the sk-or-… key).

import { existsSync, readFileSync } from 'node:fs';

const KEY_FILE = process.env.OPENROUTER_API_KEY_FILE
  ?? '/Users/ccheever/Dropbox/APIKeys/openrouter.txt';

export function loadOpenRouterKey(): string {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  if (existsSync(KEY_FILE)) {
    const lines = readFileSync(KEY_FILE, 'utf8').split(/\r?\n/).map((line) => line.trim());
    const key = lines.find((line) => line.startsWith('sk-or-'));
    if (key) return key;
  }
  throw new Error(`no OpenRouter key: set OPENROUTER_API_KEY or provide ${KEY_FILE}`);
}

const HEADERS = () => ({
  Authorization: `Bearer ${loadOpenRouterKey()}`,
  'content-type': 'application/json',
  'HTTP-Referer': 'https://github.com/ccheever/snapback',
  'X-Title': 'snapback chat-matrix demo',
});

export interface CatalogModel {
  id: string;
  name: string;
  contextLength: number | null;
}

let catalogCache: { at: number; models: CatalogModel[] } | null = null;

export async function listModels(): Promise<CatalogModel[]> {
  if (catalogCache && Date.now() - catalogCache.at < 10 * 60_000) return catalogCache.models;
  const response = await fetch('https://openrouter.ai/api/v1/models', { headers: HEADERS() });
  if (!response.ok) throw new Error(`OpenRouter models: HTTP ${response.status}`);
  const payload = await response.json() as { data: { id: string; name?: string; context_length?: number }[] };
  const models = payload.data
    .map((model) => ({ id: model.id, name: model.name ?? model.id, contextLength: model.context_length ?? null }))
    .sort((left, right) => left.id.localeCompare(right.id));
  catalogCache = { at: Date.now(), models };
  return models;
}

// Streams a chat completion, invoking onDelta with the accumulated assistant
// text as chunks arrive. Returns the final text.
export async function streamCompletion(
  model: string,
  messages: { role: string; content: string }[],
  onDelta: (accumulated: string) => void | Promise<void>,
  { signal }: { signal?: AbortSignal } = {},
): Promise<string> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: HEADERS(),
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`OpenRouter completion: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
  }
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let parsed: any;
      try { parsed = JSON.parse(data); } catch { continue; }
      const delta = parsed.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        accumulated += delta;
        await onDelta(accumulated);
      }
      const errorMessage = parsed.error?.message;
      if (errorMessage) throw new Error(`OpenRouter stream error: ${errorMessage}`);
    }
  }
  return accumulated;
}
