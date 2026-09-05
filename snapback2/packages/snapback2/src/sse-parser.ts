interface ParsedEvent { id?: string; data: string }
function abortError(): Error { const error = new Error("subscription closed"); error.name = "AbortError"; return error; }

export async function* parseSse(
  response: Response,
  signal: AbortSignal,
  onActivity: () => void,
): AsyncGenerator<ParsedEvent> {
  if (!response.body) throw new Error("SSE response has no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  let id: string | undefined;
  let finished = false;
  const line = (raw: string): ParsedEvent | undefined => {
    const value = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (value === "") {
      if (data.length === 0) return undefined;
      const event = { id, data: data.join("\n") };
      data = [];
      id = undefined;
      onActivity();
      return event;
    }
    if (value.startsWith(":")) {
      onActivity();
      return undefined;
    }
    const colon = value.indexOf(":");
    const field = colon < 0 ? value : value.slice(0, colon);
    let fieldValue = colon < 0 ? "" : value.slice(colon + 1);
    if (fieldValue.startsWith(" ")) fieldValue = fieldValue.slice(1);
    if (field === "data") data.push(fieldValue);
    if (field === "id" && !fieldValue.includes("\0")) id = fieldValue;
    return undefined;
  };
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const event = line(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        if (event) yield event;
        newline = buffer.indexOf("\n");
      }
      // A fence may race with a read that already returned bytes. Let the
      // transport inspect complete buffered frames for terminal authority
      // evidence, but never finalize an incomplete frame after abort.
      if (signal.aborted) throw abortError();
      if (chunk.done) {
        finished = true;
        break;
      }
    }
    if (buffer.length > 0) {
      const event = line(buffer);
      if (event) yield event;
    }
    const final = line("");
    if (final) yield final;
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
