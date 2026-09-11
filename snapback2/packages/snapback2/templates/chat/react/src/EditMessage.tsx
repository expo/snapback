import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation } from "snapback2/react";
import { refusalDetails } from "../shared/status";
import { messageWrites } from "../shared/thread";

type Props = { messageId: string; body: string; onClose(): void };
type Note = { note: string; details: string; attempt?: string; gone?: boolean };
/** Keeps the attempted text until the owner accepts it or the person cancels. */
export function EditMessage({ messageId, body, onClose }: Props) {
  const edit = useMutation(messageWrites.update);
  const [base, setBase] = useState(body);
  const [draft, setDraft] = useState(body);
  const [result, setResult] = useState<Note>();
  const latest = useRef(draft);
  latest.current = draft;
  const open = useRef(true);
  useEffect(() => { open.current = true; return () => { open.current = false; }; }, []);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const attempt = draft;
    if (!attempt.trim() || attempt === base || edit.inFlight) return;
    setResult(undefined);
    const outcome = await edit.run({ messageId, body: attempt, baseBody: base });
    if (!open.current) return;
    // An accepted attempt is the base for newer text; only the text it answers closes the editor.
    if (outcome.state !== "rejected") return latest.current === attempt ? onClose() : setBase(attempt);
    const details = refusalDetails(outcome);
    if (outcome.reason === "conflict") {
      const current = outcome.current?.body;
      if (typeof current === "string") setBase(current);
      return setResult({ details, gone: typeof current !== "string", note: typeof current === "string"
        ? `Edit not sent. Current message: ${current}. Save again to replace it.` : "Edit not sent. The message is no longer readable." });
    }
    if (latest.current === attempt) setResult({ attempt, details, note: "Could not confirm edit. Your edit is still here; open details for the next step." });
  };
  return <form aria-label="Edit message" className="edit" onSubmit={(event) => { void save(event); }}>
    <input aria-label="Edited message" value={draft} maxLength={4000} autoFocus onChange={(event) => setDraft(event.target.value)} />
    <button type="submit" disabled={edit.inFlight || !draft.trim() || draft === base || result?.gone === true}>Save</button>
    <button type="button" onClick={onClose}>Cancel</button>
    {result && (result.attempt === undefined || result.attempt === draft) ? <div><p role="alert">{result.note}</p>
      <details><summary>Edit details</summary><pre>{result.details}</pre></details></div> : null}
  </form>;
}
