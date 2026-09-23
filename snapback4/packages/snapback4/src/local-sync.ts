// 0.2.32 denies unknown SyncRequest fields, but hides serde's reason behind
// this exact input refusal. A successful stripped retry distinguishes an old
// parser from a bad cursor, limit or pending id with the same refusal.
export const legacyInputRefusal = { denied: { code: "E_INPUT", family: "input",
  message: "sync needs { from, limit, after, stream, pending }: nonnegative integers, a cursor or null, a boolean, and at most 256 ids of 1..128 UTF-8 bytes" } };

async function legacyInput(response: Response): Promise<boolean> {
  const reply = await response.clone().json().catch(() => null);
  return reply != null && Object.keys(reply).length === 1 && reply.denied != null
    && Object.keys(reply.denied).length === 3
    && Object.entries(legacyInputRefusal.denied).every(([key, value]) => reply.denied[key] === value);
}

export function syncTransport(doFetch: typeof fetch) {
  const legacyOrigins = new Set<string>();
  return async (url: string, init: RequestInit, body: Record<string, unknown>): Promise<Response> => {
    const origin = new URL(url).origin;
    const { generation: _, ...withoutGeneration } = body;
    const attempt = legacyOrigins.has(origin) ? withoutGeneration : body;
    const sentGeneration = Object.hasOwn(attempt, "generation") && attempt.generation !== undefined;
    const response = await doFetch(url, { ...init, body: JSON.stringify(attempt) });
    if (sentGeneration && response.status === 400 && await legacyInput(response)) {
      const retry = await doFetch(url, { ...init, body: JSON.stringify(withoutGeneration) });
      if (!await legacyInput(retry)) legacyOrigins.add(origin);
      return retry;
    }
    return response;
  };
}
