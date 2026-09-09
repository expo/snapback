import { useState } from "react";
import { api, type Principal } from "snapback2/client";
import { useMutation } from "snapback2/react";

export function NewConversation({ onOpen }: { onOpen(id: string): void }) {
  const [title, setTitle] = useState(""), [member, setMember] = useState("");
  const create = useMutation(api.groups.groupCreate);
  const submit = async () => {
    const result = await create.run({ title: title.trim(), members: [member.trim() as Principal] });
    if (result.state === "committed") { setTitle(""); setMember(""); onOpen(result.data.id); }
  };
  return <form aria-label="New conversation" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h2>New conversation</h2><p>Ask a friend to sign in and share their account ID shown above.</p>
    <label>Title <input value={title} maxLength={120} required onChange={event => setTitle(event.target.value)} /></label>
    <label>Member account ID <input value={member} required onChange={event => setMember(event.target.value)} /></label>
    <button disabled={create.inFlight || !create.can.send || !title.trim() || !member.trim()}>Create conversation</button>
    {create.last?.state === "rejected" ? <p role="alert">{create.last.message}</p> :
      create.last?.state === "queued" ? <p role="status">Queued. Your conversation will appear after reconnecting.</p> : null}
    {!create.can.send ? <p role="status">{create.can.reason?.message}</p> : null}
  </form>;
}
