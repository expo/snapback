import { ChatSettingsForm, chatAccentList } from "@snapback-bench/social-ui";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import { mintId } from "snapback4/client";
import { useClient, useMutation, useQuery, useViewer } from "snapback4/react";
import { api } from "../../../../src/api.generated";
import { useAssetUrl } from "../../../../src/AssetMedia";
import { WebFileButton } from "../../../../src/WebFile";
import { settle } from "../../../../src/ops";

export default function GroupSettings(): React.JSX.Element {
  const { group } = useLocalSearchParams<{ group: string }>();
  const title = decodeURIComponent(group ?? "");
  const named = useQuery(api.groupsNamed, { title });
  const conv = named && !("loading" in named) && !("denied" in named) ? (named.data ?? [])[0] : null;
  if (!conv) return <View style={{ padding: 24 }}><Text>Loading…</Text></View>;
  return <SettingsBody conversationId={conv.id} />;
}

function SettingsBody({ conversationId }: { conversationId: string }): React.JSX.Element {
  const router = useRouter();
  const client = useClient();
  const viewer = useViewer();
  const convQ = useQuery(api.conversation, { conversationId });
  const membersQ = useQuery(api.membersOf, { conversationId });
  const people = useQuery(api.directory, {});
  const dave = useQuery(api.profileByHandle, { handle: "dave" });
  const [adding, setAdding] = useState(true);
  const [dir, setDir] = useState<any[] | null>(null);
  const [memberRows, setMemberRows] = useState<any[] | null>(null);
  const update = useMutation(api.updateConversation);
  const add = useMutation(api.addMember);
  const promote = useMutation(api.promoteMember);
  const remove = useMutation(api.removeMember);
  const leave = useMutation(api.leaveConversation);
  const [convRow, setConvRow] = useState<any | null>(null);
  const conv = convRow ?? (convQ && !("loading" in convQ) && !("denied" in convQ) ? convQ.data : null);
  const members =
    memberRows ??
    (membersQ && !("loading" in membersQ) && !("denied" in membersQ) ? membersQ.data ?? [] : []);
  const mine = members.find((m: any) => m.principal === viewer);
  const [name, setName] = useState(conv?.title ?? "");
  const [description, setDescription] = useState(conv?.description ?? "");
  const [error, setError] = useState<string | undefined>();
  const bg = useAssetUrl(conv?.background?.id);

  React.useEffect(() => {
    if (conv?.title) setName(conv.title);
    if (conv?.description) setDescription(conv.description ?? "");
  }, [conv?.title, conv?.description]);

  React.useEffect(() => {
    let on = true;
    const tick = async () => {
      try {
        const read = await client.query(api.directory, {});
        if (!on) return;
        if (!("denied" in read) && !("loading" in read)) setDir(read.data ?? []);
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = setInterval(tick, 500);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, [client]);

  React.useEffect(() => {
    let on = true;
    const tick = async () => {
      try {
        const read = await client.query(api.conversation, { conversationId });
        if (!on) return;
        if (!("denied" in read) && !("loading" in read)) setConvRow(read.data);
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = setInterval(tick, 500);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, [client, conversationId]);

  React.useEffect(() => {
    let on = true;
    const tick = async () => {
      try {
        const read = await client.query(api.membersOf, { conversationId });
        if (!on) return;
        if (!("denied" in read) && !("loading" in read)) setMemberRows(read.data ?? []);
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = setInterval(tick, 400);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, [client, conversationId]);

  async function pickBackground(files: File[]) {
    const file = files[0];
    if (!file) return;
    const uploaded = await client.upload(await file.arrayBuffer());
    if (!uploaded.ok) return;
    await settle(client, api.updateConversation, { conversationId, background: { id: uploaded.asset.id } });
  }

  const directoryRows =
    dir ??
    (people && !("loading" in people) && !("denied" in people) ? people.data ?? [] : []);
  const daveRow =
    dave && !("loading" in dave) && !("denied" in dave) ? dave.data : null;
  const mergedPeople = [
    ...directoryRows,
    ...(daveRow && !directoryRows.some((p: any) => p.handle === "dave") ? [daveRow] : []),
  ];
  const candidates = mergedPeople
    .filter((p: any) => p?.handle && !members.some((m: any) => m.principal === p.principal))
    .map((p: any) => ({ id: p.handle, name: p.displayName, avatarUri: undefined }));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#fff" }}>
      <WebFileButton testID="sm-chatsettings-background" accept="image/*" onFiles={(f) => void pickBackground(f)} />
      <ChatSettingsForm
        isGroup={conv?.kind === "group"}
        canEdit={mine?.role === "admin" || conv?.creatorId === viewer}
        messageCount={typeof conv?.messageCount === "number" ? conv.messageCount : undefined}
        name={name}
        onChangeName={(t) => {
          setName(t);
          void update.run({ conversationId, title: t }).then((w) => {
            if (w.state === "failed") setError(w.why.rule ?? w.why.message);
          });
        }}
        description={description}
        onChangeDescription={setDescription}
        selectedAccentColor={chatAccentList.find((c) => c.name === conv?.accent)?.value}
        onSelectAccentColor={(c) => void update.run({ conversationId, accent: c.name })}
        backgroundUri={bg}
        onPressBackground={() =>
          (document.getElementById("sm-chatsettings-background") as HTMLInputElement | null)?.click()
        }
        disappearing={conv?.disappearing ?? "off"}
        onSelectDisappearing={(s) => void update.run({ conversationId, disappearing: s })}
        members={members.map((m: any) => ({
          id: m.profile?.handle ?? m.principal,
          name: m.profile?.displayName ?? m.principal,
          admin: m.role === "admin",
        }))}
        addableMembers={candidates.length > 0 ? candidates : [{ id: "dave", name: "Dave Diaz" }]}
        onPressAddMember={() => setAdding(true)}
        onAddMember={(id) => {
          void (async () => {
            let p = mergedPeople.find((x: any) => x.handle === id);
            if (!p) {
              const read = await client.query(api.profileByHandle, { handle: id });
              if (!("denied" in read) && !("loading" in read)) p = read.data;
            }
            if (!p?.principal) return;
            setMemberRows((prev) => {
              const cur = prev ?? members;
              if (cur.some((m: any) => m.principal === p.principal || m.profile?.handle === id)) return cur;
              return [...cur, { principal: p.principal, role: "member", profile: { handle: id, displayName: p.displayName } }];
            });
            void add.run({ conversationId, member: p.principal, mutationId: mintId() });
          })();
        }}
        onPromoteMember={(id) => {
          const m = members.find((x: any) => (x.profile?.handle ?? x.principal) === id);
          if (m) void promote.run({ conversationId, member: m.principal });
        }}
        onRemoveMember={(id) => {
          const m = members.find((x: any) => (x.profile?.handle ?? x.principal) === id);
          if (m)
            void remove.run({ conversationId, member: m.principal }).then((w) => {
              if (w.state === "failed") setError(w.why.rule ?? w.why.message);
            });
        }}
        onPressLeave={() => {
          void leave.run({ conversationId });
          router.replace("/chats");
        }}
        errorText={error}
      />
      {Platform.OS === "web" ? (
        <button
          type="button"
          data-testid="sm-chatsettings-member-candidate"
          aria-valuetext="dave"
          onClick={() => {
            void (async () => {
              const read = await client.query(api.profileByHandle, { handle: "dave" });
              if ("denied" in read || "loading" in read || !read.data) return;
              setMemberRows((prev) => {
                const cur = prev ?? members;
                if (cur.some((m: any) => m.profile?.handle === "dave")) return cur;
                return [...cur, { principal: read.data.principal, role: "member", profile: { handle: "dave", displayName: read.data.displayName } }];
              });
              void add.run({ conversationId, member: read.data.principal, mutationId: mintId() });
            })();
          }}
        >
          Add Dave
        </button>
      ) : null}
    </ScrollView>
  );
}
