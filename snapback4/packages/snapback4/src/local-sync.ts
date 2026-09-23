// 0.2.32 denies unknown SyncRequest fields, but hides serde's reason behind
// this exact input refusal. Only retry that response to our valid SDK request.
const legacyInput = "sync needs { from, limit, after, stream, pending }: nonnegative integers, a cursor or null, a boolean, and at most 256 ids of 1..128 UTF-8 bytes";

export function syncTransport(doFetch: typeof fetch) {
  let legacy = false;
  return async (url: string, init: RequestInit, body: Record<string, unknown>): Promise<Response> => {
    const { generation: _, ...withoutGeneration } = body;
    const send = () => doFetch(url, { ...init, body: JSON.stringify(legacy ? withoutGeneration : body) });
    const response = await send();
    if (!legacy && response.status === 400) {
      const reply = await response.clone().json().catch(() => null);
      if (reply?.denied?.code === "E_INPUT" && reply.denied.family === "input" && reply.denied.message === legacyInput) {
        legacy = true;
        return send();
      }
    }
    return response;
  };
}
