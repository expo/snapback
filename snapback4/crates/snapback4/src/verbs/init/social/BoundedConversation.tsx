import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button, Text, TextInput, View } from "react-native";
import { matchRead, isReady } from "snapback4/contract";
import { useClient, useMutation, usePage, useQuery, useViewer } from "snapback4/react";
import { api } from "../snapback/generated/api";
import { PageLifetime } from "./PageLifetime";
import { OnceViewer } from "./Conversation";

// @ref LLP 3000.023#13 — route ownership and a bounded identity-only window.
// This small alternative screen intentionally renders at most 20 message bodies
// from at most three requested pages. Composer intent stays outside read owners.
export function BoundedConversation({ backend, conversation, active }: {
  backend: string; conversation: string; active: boolean;
}) {
  const client = useClient(), viewer = useViewer();
  const key = JSON.stringify([backend, viewer, conversation]);
  const [owner, setOwner] = useState({ client, key, epoch: 0 });
  // Reset before committing children, including replacement at the same URL.
  if (owner.client !== client || owner.key !== key) setOwner({ client, key, epoch: owner.epoch + 1 });
  return <ClientOwner key={owner.epoch} conversation={conversation} active={active} />;
}
function ClientOwner({ conversation, active }: { conversation: string; active: boolean }) {
  const client = useClient(), viewer = useViewer(), send = useMutation(api.send);
  const [draft, setDraft] = useState("");
  const [submitted, setSubmitted] = useState<{ id: string; text: string }>();
  const [refused, setRefused] = useState<{ text: string; message: string }>();
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (submitted && send.last?.id === submitted.id && send.last.state === "failed") {
      setDraft(current => current || submitted.text);
      setRefused({ text: submitted.text, message: send.last.why.message });
    }
  }, [submitted, send.last]);
  async function submit() {
    const text = draft; setDraft(""); setSubmitted(undefined); setRefused(undefined);
    const result = await send.run({ conversation, text, photo: null }, { waitSeconds: 0 });
    if (!alive.current || client.viewer() !== viewer) return;
    setSubmitted({ id: result.id, text });
  }
  return <View><TextInput accessibilityLabel="Message draft" value={draft} onChangeText={setDraft} />
    {refused && <View><Text>{refused.message}</Text><Button title="Edit refused send" onPress={() => {
      setDraft(refused.text); setRefused(undefined);
    }} /></View>}
    {active && <LiveConversation conversation={conversation} canSend={!send.inFlight && !!draft.trim()} submit={submit} />}
  </View>;
}
function LiveConversation({ conversation, canSend, submit }: { conversation: string; canSend: boolean; submit(): Promise<void> }) {
  const client = useClient();
  const member = useQuery(api.receiptMember, { conversation }, { keep: false });
  const blocked = matchRead(member, { denied: () => true, absent: read => read.fresh && !read.revalidating, partial: () => false, otherwise: () => false });
  const lifetime = useMemo(() => new PageLifetime(client, api.history, { conversation, c: null }), [client, conversation]);
  const scope = useSyncExternalStore(lifetime.subscribe, lifetime.getSnapshot, lifetime.getSnapshot);
  return <View>
    <Button title="Send" disabled={blocked || !canSend} onPress={() => void submit()} />
    {scope.ready ? <IdentityHistory key={scope.epoch} conversation={conversation} /> : <Text>History unavailable</Text>}
  </View>;
}
function IdentityHistory({ conversation }: { conversation: string }) {
  const page = usePage(api.history, { conversation });
  const [pages, setPages] = useState(1), [start, setStart] = useState(0);
  const [selected, select] = useState<{ message: string; asset: string }>();
  const offset = Math.min(start, Math.max(0, page.items.length - 20));
  const ids = page.items.slice(offset, offset + 20).map(row => row.id);
  return <View>
    {ids.map(id => <MessageBody key={id} id={id} select={select} />)}
    <Button title="Previous rows" disabled={!offset} onPress={() => setStart(Math.max(0, offset - 20))} />
    <Button title="Next rows" disabled={offset + 20 >= page.items.length} onPress={() => setStart(offset + 20)} />
    <Button title="Older page" disabled={pages >= 3 || !page.hasMore} onPress={() => { setPages(pages + 1); page.loadMore(); }} />
    {selected && <OnceViewer key={selected.asset} {...selected} onClose={() => select(undefined)} />}
  </View>;
}
function MessageBody({ id, select }: { id: string; select(value: { message: string; asset: string }): void }) {
  const read = useQuery(api.messagePhoto, { id }, { keep: false });
  if (!isReady(read) || read.existence !== "present") return <Text>Message unavailable</Text>;
  return <View><Text>{read.data.text}</Text>
    {read.data.photo && <Button title="Select photo" disabled={read.revalidating === true} onPress={() => {
      if (!read.revalidating && read.data.photo) select({ message: id, asset: read.data.photo.id });
    }} />}
  </View>;
}
