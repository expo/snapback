import { useMemo, useState } from "react";
import { Platform, ScrollView } from "react-native";
import { useAsset, useMutation, usePage, useQuery, useViewer } from "snapback4/react";
import { isReady } from "snapback4/contract";
import { ChatSettingsForm, chatAccentList, type ChatAccent, type DisappearingSetting } from "@snapback-bench/social-ui";
import { api } from "../snapback/generated/api";
import { HiddenFileInput, useUploader } from "./media";

export default function ChatSettingsScreen({ conversation }: { conversation: string }) {
  const viewer = useViewer();
  const room = useQuery(api.conversationScreen, { conversation });
  const members = usePage(api.membersOf, { conversation });
  const people = usePage(api.people, { q: "da" });
  const update = useMutation(api.updateChat);
  const background = useMutation(api.placeBackground);
  const add = useMutation(api.addMember);
  const remove = useMutation(api.removeMember);
  const promote = useMutation(api.promoteMember);
  const leave = useMutation(api.leaveChat);
  const upload = useUploader();
  const chat = isReady(room) ? room.data : null;
  const bg = useAsset(chat?.background?.id ?? null);
  const me = members.items.find((row) => row.principal === viewer);
  const canEdit = chat?.kind === "dm" || me?.role === "admin";
  const memberItems = members.items.map((row) => ({
    id: row.profile?.handle ?? row.principal,
    name: row.profile?.displayName ?? row.principal,
    admin: row.role === "admin",
    principal: row.principal,
  }));
  const memberHandles = new Set(memberItems.map((row) => row.id));
  const addable = people.items
    .filter((person) => !memberHandles.has(person.handle))
    .map((person) => ({ id: person.handle, name: person.displayName, principal: person.principal }));
  const principalByHandle = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of memberItems) map.set(row.id, row.principal);
    for (const row of addable) map.set(row.id, row.principal);
    return map;
  }, [memberItems, addable]);

  async function onBackground(files: File[]) {
    const file = files[0];
    if (!file) return;
    const asset = await upload(file);
    await background.run({ conversation, background: { id: asset.id } });
  }

  if (!chat) return null;
  return (
    <ScrollView>
      <HiddenFileInput testID="sm-chatsettings-background-file" accept="image/*" onFiles={(files) => void onBackground(files)} />
      <ChatSettingsForm
        isGroup={chat.kind === "group"}
        canEdit={!!canEdit}
        name={chat.title ?? undefined}
        onChangeName={(title) => void update.run({ conversation, title })}
        description={chat.description ?? undefined}
        onChangeDescription={(description) => void update.run({ conversation, description })}
        accentColors={chatAccentList}
        selectedAccentColor={chat.accent ?? undefined}
        onSelectAccentColor={(accent: ChatAccent) => void update.run({ conversation, accent: accent.value })}
        backgroundUri={bg.status === "ready" ? bg.url : undefined}
        onPressBackground={() => {
          if (Platform.OS !== "web") return;
          const node = document.querySelector('[data-testid="sm-chatsettings-background-file"]') as HTMLInputElement | null;
          node?.click();
        }}
        disappearing={chat.disappearing as DisappearingSetting}
        onSelectDisappearing={(setting) => void update.run({ conversation, disappearing: setting })}
        members={memberItems}
        addableMembers={addable}
        onPressAddMember={() => {}}
        onAddMember={(handle) => {
          const principal = principalByHandle.get(handle);
          if (principal) void add.run({ conversation, principal });
        }}
        onRemoveMember={(handle) => {
          const principal = principalByHandle.get(handle);
          if (principal) void remove.run({ conversation, principal });
        }}
        onPromoteMember={(handle) => {
          const principal = principalByHandle.get(handle);
          if (principal) void promote.run({ conversation, principal });
        }}
        onPressLeave={() => void leave.run({ conversation })}
        errorText={add.last?.state === "failed" ? add.last.why.message : undefined}
      />
    </ScrollView>
  );
}
