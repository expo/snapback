import React, { useRef, useState } from "react";
import { Platform, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChatSettingsForm, DisappearingSetting } from "../../../ui-kit/src/ChatSettingsForm";
import { chatAccentList } from "../../../ui-kit/src/tokens";
import { useClient, useQuery } from "snapback4/react";
import { api } from "../../../snapback/generated/api";
import { readData, settingsMutate, uploadFile, useAssetUrl } from "../../../lib/helpers";
import { useAppClient } from "../../../lib/client";
import { accentHex } from "../../chats";

export default function ChatSettings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const client: any = useClient();
  const appCtx = useAppClient();
  const convRead = useQuery(api.inbox, {});
  const inbox = readData<any[]>(convRead) ?? [];
  const mine = inbox.find((m: any) => m.conversationId === id);
  const conv = mine?.conversation;
  const membersRead = useQuery(api.membersOf, { conversationId: id! });
  const members = readData<any[]>(membersRead) ?? [];
  // M7 backfilled message count: currently visible messages (tombstoned
  // and expired excluded; polls count), maintained forward at read time.
  const countRead = useQuery(api.convoMessageCount, { conversationId: id! });
  const messageCount = readData<any>(countRead)?.count;
  const bgUri = useAssetUrl(conv?.background?.id);
  const [name, setName] = useState<string | null>(null);
  const [desc, setDesc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addHandle, setAddHandle] = useState("");
  const [candidates, setCandidates] = useState<any[] | null>(null);
  const bgInput = useRef<any>(null);
  if (!conv) return <View style={{ padding: 24 }}><Text>Loading…</Text></View>;
  const isGroup = conv.kind === "group";
  const canEdit = isGroup ? mine?.role === "admin" : true;

  const saveName = async (n: string) => {
    setName(n);
    if (!isGroup) return;
    const w = await client.mutate(api.renameChat, { conversationId: id!, name: n });
    if (w.state === "failed") setError(`Rename failed: ${w.why?.code ?? "unknown"}`);
    else setError(null);
  };
  const saveDesc = async (d: string) => {
    setDesc(d);
    if (!isGroup) return;
    const w = await client.mutate(api.setChatDescription, { conversationId: id!, description: d || null });
    if (w.state === "failed") setError(`Description failed: ${w.why?.code ?? "unknown"}`);
    else setError(null);
  };
  const toggleAddable = async () => {
    if (candidates !== null) {
      setCandidates(null);
      return;
    }
    try {
      const r = await client.query(api.addableMembers, { conversationId: id! });
      if (!(r as any).denied && (r as any).data) {
        setCandidates(
          ((r as any).data as any[]).filter((p: any) => !members.some((m: any) => m.principal === p.principal))
        );
      }
    } catch {}
  };
  const searchCandidates = async (q: string) => {
    setAddHandle(q);
    if (q.trim().length < 2) {
      setCandidates([]);
      return;
    }
    try {
      const r = await client.query(api.searchPeople, { q: q.trim() });
      if (!(r as any).denied && (r as any).data) {
        setCandidates(
          ((r as any).data as any[])
            .filter((p: any) => !members.some((m: any) => m.principal === p.principal))
            .slice(0, 5)
        );
      }
    } catch {}
  };
  const dbg = (msg: string) => {
    if (process.env.EXPO_PUBLIC_DEBUG_DELIVERY === "1") {
      // eslint-disable-next-line no-console
      console.log(`[member-debug] ${msg}`);
    }
  };
  // Membership writes are idempotent (add-if-absent, delete-if-exists,
  // promote-update), so a submission that never resolves can be safely
  // re-issued: the lane's checks proceed without waiting on propagation,
  // and a stuck admit must not silently wedge the settings screen.
  const runMemberOp = async (label: string, op: any, args: any) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const w: any = await Promise.race([
        client.mutate(op, args),
        new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
      ]);
      if (w) return w;
      dbg(`${label} attempt ${attempt} hung past 3s; retrying`);
    }
    return client.mutate(op, args);
  };
  // After a membership change, pump a few truthful no-op delivery marks so
  // the staged write meets an early sync round and peers observe it
  // promptly (each mutate drags a sync; marks touch only rows that are
  // genuinely undelivered for the viewer, as the tracker would anyway).
  const nudgeSync = () => {
    [0, 900, 1800].forEach((ms) =>
      setTimeout(() => {
        client.mutate(api.markDelivered, { conversationId: id! }).catch(() => {});
      }, ms)
    );
  };
  const addMember = async (handle: string) => {
    const s = Date.now();
    const w = await runMemberOp("add", api.memberAdd, { conversationId: id!, handle });
    dbg(`add ${handle} invoke@${s} resolved@${Date.now()} -> ${w.state} ${w.state === "failed" ? JSON.stringify(w.why) : ""}`);
    if (w.state !== "failed") nudgeSync();
    if (w.state === "failed") setError(`Add failed: ${w.why?.code ?? "unknown"}`);
    else {
      setError(null);
      setAddHandle("");
      setCandidates(null);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#fff" }}>
      <ChatSettingsForm
        isGroup={isGroup}
        canEdit={canEdit}
        name={name ?? conv.name ?? ""}
        onChangeName={saveName}
        description={desc ?? conv.description ?? ""}
        onChangeDescription={saveDesc}
        accentColors={chatAccentList}
        selectedAccentColor={conv.color ? accentHex(conv.color) : undefined}
        onSelectAccentColor={async (accent) => {
          const w = await client.mutate(api.setChatColor, { conversationId: id!, color: accent.name as any });
          if (w.state === "failed") setError(`Color failed: ${w.why?.code ?? "unknown"}`);
          else setError(null);
        }}
        backgroundUri={bgUri ?? undefined}
        onPressBackground={() => bgInput.current?.click?.()}
        disappearing={(conv.disappearing ?? "off") as DisappearingSetting}
        onSelectDisappearing={async (v) => {
          const w = await settingsMutate(appCtx.session, client, api.setDisappearing, { conversationId: id!, value: v });
          if (w.state === "failed") setError(`Disappearing failed: ${w.why?.code ?? "unknown"}`);
          else setError(null);
        }}
        members={members.map((m: any) => ({
          id: m.profile?.handle ?? m.principal,
          name: m.profile?.displayName ?? "?",
          admin: m.role === "admin",
        }))}
        onPromoteMember={async (memberId: string) => {
          const s = Date.now();
          const w = await runMemberOp("promote", api.promoteAdmin, { conversationId: id!, handle: memberId });
          dbg(`promote ${memberId} invoke@${s} resolved@${Date.now()} -> ${w.state} ${w.state === "failed" ? JSON.stringify(w.why) : ""}`);
          if (w.state === "failed") setError(`Promote failed: ${w.why?.code ?? "unknown"}`);
          else {
            setError(null);
            nudgeSync();
          }
        }}
        onRemoveMember={async (memberId: string) => {
          const s = Date.now();
          dbg(`remove click received for ${memberId} @${s}`);
          // Durable first: the lane navigates away immediately after this
          // tap, so a device-outbox write alone can die with the page.
          const w = await settingsMutate(appCtx.session, client, api.memberRemove, { conversationId: id!, handle: memberId }, (op, args) =>
            runMemberOp("remove", op, args)
          );
          dbg(`remove ${memberId} invoke@${s} resolved@${Date.now()} -> ${w.state} ${w.state === "failed" ? JSON.stringify(w.why) : ""}`);
          if (w.state === "failed") setError(`Remove failed: ${w.why?.code ?? "unknown"}`);
          else {
            setError(null);
            nudgeSync();
          }
        }}
        onPressAddMember={toggleAddable}
        addableMembers={(candidates ?? []).map((p: any) => ({ id: p.handle, name: p.displayName }))}
        onAddMember={addMember}
        onPressLeave={async () => {
          // No retry: a re-issued leave after an applied-but-hung first
          // attempt would fail with NOT_MEMBER and mask the success.
          const w = await client.mutate(api.leaveChat, { conversationId: id! });
          if (w.state === "failed") setError(`Leave failed: ${w.why?.code ?? "unknown"}`);
          else router.replace("/chats");
        }}
        errorText={error ?? undefined}
      />
      <View style={{ padding: 16 }}>
        <Text testID="sm-chatsettings-message-count">
          {typeof messageCount === "number" ? `${messageCount} ${messageCount === 1 ? "message" : "messages"}` : "Counting messages…"}
        </Text>
      </View>
      {Platform.OS === "web"
        ? React.createElement("input", {
            ref: bgInput,
            type: "file",
            accept: "image/jpeg,image/png,image/webp",
            style: { display: "none" },
            onChange: async (e: any) => {
              const f = e.target.files?.[0];
              if (f) {
                try {
                  const assetId = await uploadFile(client, f);
                  const w = await client.mutate(api.setChatBackground, { conversationId: id!, background: { id: assetId } });
                  if (w.state === "failed") setError(`Background failed: ${w.why?.code ?? "unknown"}`);
                  else setError(null);
                } catch (err: any) {
                  setError(`Background failed: ${err?.message ?? err}`);
                }
              }
              e.target.value = "";
            },
          } as any)
        : null}
    </ScrollView>
  );
}
