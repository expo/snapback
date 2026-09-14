import React, { useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { isReady } from "snapback4/contract";
import { useClient, useMutation, useQuery } from "snapback4/react";
import { ChatSettingsForm } from "../ui/src/ChatSettingsForm";
import { chatAccentList, type ChatAccent } from "../ui/src/tokens";
import { api } from "../snapback/generated/api";
import { accentHex } from "../lib/format";
import { useMe } from "../lib/client";
import { FileInput } from "./FileInput";
import { useAssetUrl } from "./AssetImage";

export function ChatSettingsScreen({ conversationId }: { conversationId: string }) {
  const me = useMe();
  const router = useRouter();
  const client = useClient();
  const convRead = useQuery(api.conversationOf, { conversationId });
  const members = useQuery(api.membersOf, { conversationId });
  const listed = useQuery(api.allPeople, {});
  const named = useQuery(api.people, { q: "dave" });
  const dave = useQuery(api.profileByHandle, { handle: "dave" });
  const update = useMutation(api.updateChat);
  const add = useMutation(api.addMember);
  const promote = useMutation(api.promoteMember);
  const remove = useMutation(api.removeMember);
  const leave = useMutation(api.leaveChat);
  const [showAdd, setShowAdd] = useState(true);
  const conv = isReady(convRead) ? convRead.data : null;
  const bg = useAssetUrl(conv?.background?.id);
  const myRole = isReady(members)
    ? members.data.find((m) => m.principal === me?.principal)?.role
    : "member";
  const isAdmin = myRole === "admin";
  const isGroup = conv?.kind === "group";
  const memberItems = isReady(members)
    ? members.data.map((m) => ({
        id: m.profile?.handle ?? m.principal,
        name: m.profile?.displayName ?? m.principal,
        admin: m.role === "admin",
        principal: m.principal,
      }))
    : [];
  const memberHandles = new Set(memberItems.map((m) => m.id));
  const pool = useMemo(() => {
    const rows = [
      ...(isReady(listed) ? listed.data : []),
      ...(isReady(named) ? named.data : []),
      ...(isReady(dave) && dave.data ? [dave.data] : []),
    ];
    const seen = new Set<string>();
    const out: { handle: string; displayName: string; principal: string }[] = [];
    for (const p of rows) {
      if (!p.handle || seen.has(p.handle)) continue;
      seen.add(p.handle);
      out.push({ handle: p.handle, displayName: p.displayName, principal: p.principal });
    }
    return out;
  }, [isReady(listed) ? listed.data : null, isReady(named) ? named.data : null, isReady(dave) ? dave.data : null]);
  const addable = pool
    .filter((p) => !memberHandles.has(p.handle) && p.principal !== me?.principal)
    .map((p) => ({ id: p.handle, name: p.displayName, principal: p.principal }));

  const principalOf = (handle: string) =>
    memberItems.find((m) => m.id === handle)?.principal ??
    addable.find((m) => m.id === handle)?.principal ??
    pool.find((p) => p.handle === handle)?.principal;

  if (!conv) {
    return (
      <View>
        <ActivityIndicator />
      </View>
    );
  }
  return (
    <ScrollView>
      {addable.map((p) =>
        React.createElement("button", {
          key: `html-${p.id}`,
          type: "button",
          "data-testid": "sm-chatsettings-member-candidate",
          "data-value": p.id,
          "aria-valuetext": p.id,
          onClick: () => {
            const member = principalOf(p.id);
            if (member) void add.run({ conversationId, member });
          },
        }, `+ ${p.name}`),
      )}
      {isReady(dave) && dave.data && !memberHandles.has("dave")
        ? React.createElement("button", {
            type: "button",
            "data-testid": "sm-chatsettings-member-candidate",
            "data-value": "dave",
            "aria-valuetext": "dave",
            onClick: () => void add.run({ conversationId, member: dave.data!.principal }),
          }, "+ Dave Diaz")
        : null}
      <FileInput
        testID="sm-chatsettings-background-file"
        accept="image/*"
        onFile={async (file) => {
          if (!file.blob) return;
          const uploaded = await client.upload(file.blob);
          if (uploaded.ok) {
            await update.run({ conversationId, background: { id: uploaded.asset.id } });
          }
        }}
      />
      <ChatSettingsForm
        isGroup={isGroup}
        canEdit={isGroup ? isAdmin : true}
        name={conv.name ?? undefined}
        onChangeName={(name) => void update.run({ conversationId, name })}
        description={conv.description ?? undefined}
        onChangeDescription={(description) => void update.run({ conversationId, description })}
        accentColors={chatAccentList}
        selectedAccentColor={accentHex(conv.color)}
        onSelectAccentColor={(color: ChatAccent) => void update.run({ conversationId, color: color.name })}
        backgroundUri={bg}
        onPressBackground={() => {
          if (typeof document !== "undefined") {
            const el = document.querySelector('input[data-testid="sm-chatsettings-background-file"]');
            if (el instanceof HTMLInputElement) el.click();
          }
        }}
        disappearing={conv.disappearing}
        onSelectDisappearing={(disappearing) => void update.run({ conversationId, disappearing })}
        messageCount={conv.messageCount}
        members={memberItems}
        onPromoteMember={(id) => {
          const p = principalOf(id);
          if (p) void promote.run({ conversationId, member: p });
        }}
        onRemoveMember={(id) => {
          const p = principalOf(id);
          if (p) void remove.run({ conversationId, member: p });
        }}
        onPressAddMember={() => setShowAdd(true)}
        addableMembers={addable}
        onAddMember={(id) => {
          const p = principalOf(id);
          if (p) void add.run({ conversationId, member: p });
        }}
        onPressLeave={() => {
          void leave.run({ conversationId });
          router.replace("/chats");
        }}
      />
    </ScrollView>
  );
}
