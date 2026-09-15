import { CreatePoll, Poll } from "./polls";
import * as Picker from "expo-image-picker";
import { Video, poster } from "./media";
import windows from "../config/windows.active.json";
import { randomUUID } from "expo-crypto";
import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Linking,
  Modal,
  Image,
  ImageBackground,
} from "react-native";
import { router } from "expo-router";
import { useQuery, usePage } from "snapback4/react";
import { api } from "../snapback/generated/api";
import {
  MessageBubble,
  ReactionPicker,
  Composer,
  TypingIndicator,
  ChatListRow,
  ChatSettingsForm,
} from "../ui";
import { useApp } from "./session";
import { Button, Shell } from "./common";
import { useURI } from "./post";
export function DeliveryObserver() {
  const { client } = useApp();
  const r = useQuery(api.chat.inbox, {});
  useEffect(() => {
    if ("data" in r)
      for (const item of r.data) {
        if (
          item.latest &&
          (item.latest.arrival ?? item.latest.at * 1000) >
            (item.state?.deliveredArrival ??
              (item.state?.deliveredAt ?? 0) * 1000)
        )
          client.mutate(api.chat.mark, {
            conversationId: item.conversationId,
            deliveredAt: item.latest.at,
            readAt: 0,
            deliveredArrival: item.latest.arrival,
            readArrival: 0,
          });
      }
  }, [
    "data" in r
      ? JSON.stringify(
          r.data.map((x) => [
            x.conversationId,
            x.latest?.arrival,
            x.state?.deliveredArrival,
          ]),
        )
      : "",
  ]);
  return null;
}
export function ChatRow({ item }: { item: any }) {
  const { client } = useApp();
  const other = item.roster.find((m: any) => m.principal !== client.viewer());
  const group = item.conversation?.kind === "group";
  const avatar = useURI(other?.profile?.avatar?.id);
  return (
    <ChatListRow
      identity={
        group
          ? "group:" + item.conversation.name.toLowerCase().replace(/\s+/g, "-")
          : "dm:" + other?.profile?.handle
      }
      title={
        group
          ? item.conversation.name
          : (other?.profile?.displayName ?? "Direct message")
      }
      avatarUri={avatar}
      preview={item.latest?.text ?? ""}
      unreadCount={
        item.latest?.senderId !== client.viewer() &&
        (item.latest?.arrival ?? (item.latest?.at ?? 0) * 1000) >
          (item.state?.readArrival ?? (item.state?.readAt ?? 0) * 1000)
          ? 1
          : 0
      }
      typing={item.typing.some((t: any) => t.principal !== client.viewer())}
      onPress={() => router.push("/conversation/id/" + item.conversationId)}
    />
  );
}
export function Conversation({ id }: { id: string }) {
  const { client, setError, error } = useApp();
  const { items, hasMore, loadMore } = usePage(api.chat.history, {
    conversationId: id,
  });
  const cr = useQuery(api.chat.conversation, { conversationId: id });
  const tr = useQuery(api.chat.typing, { conversationId: id });
  const r = useQuery(api.chat.roster, { conversationId: id });
  const members = "data" in r ? r.data : [];
  const c = "data" in cr ? cr.data : null;
  const [text, setText] = useState(""),
    [quote, setQuote] = useState<any>(null),
    [editing, setEditing] = useState<any>(null),
    [attachments, setAttachments] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [once, setOnce] = useState(false);
  const background = useURI(c?.background?.id);
  const scroll = useRef<ScrollView>(null);
  const positions = useRef<Record<string, number>>({});
  const latest = items[0]?.at ?? 0;
  const arrival = items[0]?.arrival;
  const mine = members.some((x) => x.principal === client.viewer());
  useEffect(() => {
    if (latest && mine)
      client.mutate(api.chat.mark, {
        conversationId: id,
        deliveredAt: latest,
        readAt: latest,
        deliveredArrival: arrival,
        readArrival: arrival,
      });
  }, [latest, arrival, mine]);
  useEffect(() => {
    scroll.current?.scrollToEnd({ animated: false });
  }, [items.length]);
  async function pick() {
    const p = await Picker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
    });
    if (!p.canceled) {
      const a = p.assets[0];
      setAttachments([
        {
          kind: a.type === "video" ? "video" : "image",
          uri: a.uri,
          posterUri: poster,
        },
      ]);
    }
  }
  async function send() {
    setBusy(true);
    setError("");
    try {
      let w;
      if (editing) {
        w = await client.mutate(api.media.edit, {
          messageId: editing.id,
          text,
        });
      } else if (attachments.length) {
        const a = attachments[0],
          u = await client.upload(await (await fetch(a.uri)).arrayBuffer());
        if (!u.ok) throw Error(u.why.message);
        w = await client.mutate(api.media.send, {
          messageId: randomUUID(),
          conversationId: id,
          caption: text,
          viewOnce: once,
          [a.kind === "video" ? "video" : "photo"]: { id: u.asset.id },
        });
      } else
        w = await client.mutate(api.chat.send, {
          messageId: randomUUID(),
          conversationId: id,
          text,
          replyToId: quote?.id ?? null,
        });
      if (w.state === "failed") throw Error(w.why.message);
      setText("");
      setQuote(null);
      setEditing(null);
      setAttachments([]);
      setOnce(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          padding: 10,
          justifyContent: "space-between",
        }}
      >
        <Text style={{ fontSize: 20, fontWeight: "700" }}>
          {c?.name ?? "Conversation"}
        </Text>
        <Button
          testID="sm-convo-settings"
          onPress={() => router.push("/conversation/id/" + id + "/settings")}
        >
          Settings
        </Button>
      </View>
      <Text style={{ paddingHorizontal: 14 }}>
        Disappearing: {c?.disappearing ?? "off"}
      </Text>
      <Button onPress={() => router.push("/search?conversationId=" + id)}>
        Search this chat
      </Button>
      <ImageBackground
        source={background ? { uri: background } : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView ref={scroll} style={{ flex: 1 }}>
          {hasMore && <Button onPress={loadMore}>Earlier messages</Button>}
          {[...items].reverse().map((m) => (
            <View
              key={m.id}
              onLayout={(e) => {
                positions.current[m.id] = e.nativeEvent.layout.y;
              }}
            >
              <Bubble
                m={m}
                group={c?.kind === "group"}
                onReply={() => setQuote(m)}
                accent={c?.color ?? undefined}
                onEdit={() => {
                  setEditing(m);
                  setText(m.text);
                }}
                onJump={() => {
                  const pos = positions.current[m.replyToId ?? ""];
                  if (pos != null)
                    scroll.current?.scrollTo({ y: pos, animated: false });
                  else if (hasMore) loadMore();
                }}
              />
            </View>
          ))}
        </ScrollView>
      </ImageBackground>
      <TypingIndicator
        visible={"data" in tr && tr.data.length > 0}
        names={
          "data" in tr
            ? tr.data.map((x) => x.profile?.displayName ?? "Someone")
            : []
        }
      />
      {quote && (
        <View>
          <Text>Replying to: {quote.text}</Text>
          <Button onPress={() => setQuote(null)}>Cancel reply</Button>
        </View>
      )}
      {editing && (
        <Button
          onPress={() => {
            setEditing(null);
            setText("");
          }}
        >
          Cancel edit
        </Button>
      )}
      {!!error && (
        <Text testID="sm-convo-error" style={{ color: "red" }}>
          {error}
        </Text>
      )}
      {attachments[0]?.kind === "image" && (
        <Button
          testID="sm-convo-viewonce-toggle"
          onPress={() => setOnce(!once)}
        >
          {once ? "View once: on" : "View once: off"}
        </Button>
      )}
      {mine && c?.kind === "group" && <CreatePoll conversationId={id} />}
      <Composer
        variant="message"
        value={text}
        onChangeText={(t) => {
          setText(t);
          if (mine) client.mutate(api.chat.type, { conversationId: id });
        }}
        onSend={send}
        onPressAttach={editing ? undefined : pick}
        attachments={attachments}
        onRemoveAttachment={() => setAttachments([])}
        maxLength={
          attachments.length || (editing?.kind !== "text" && editing)
            ? 500
            : 2000
        }
        sending={busy}
        disabled={!mine}
      />
    </Shell>
  );
}
function Bubble({
  m,
  group,
  onReply,
  onJump,
  onEdit,
  accent,
}: {
  m: any;
  group: boolean;
  onReply: () => void;
  onJump: () => void;
  onEdit: () => void;
  accent?: string;
}) {
  const { client, setError } = useApp();
  const avatar = useURI(m.sender?.avatar?.id),
    photo = useURI(m.photo?.id),
    video = useURI(m.video?.id);
  const [show, setShow] = useState(false),
    [reacting, setReacting] = useState(false),
    [custom, setCustom] = useState(""),
    [onceAsset, setOnceAsset] = useState<any>(null),
    [opened, setOpened] = useState(false);
  useEffect(() => () => onceAsset?.revoke(), [onceAsset]);
  const myEmoji = m.reactions?.find((x: any) => x.mine)?.emoji;
  const own = m.senderId === client.viewer();
  async function react(emoji: string) {
    const w = await client.mutate(api.media.react, {
      messageId: m.id,
      emoji: emoji === myEmoji ? null : emoji,
    });
    if (w.state === "failed") setError(w.why.message);
    setReacting(false);
  }
  return (
    <View testID="sm-convo-bubble">
      <MessageBubble
        testID="sm-message-content"
        isMine={own}
        text={m.kind === "poll" ? "Poll" : m.text}
        timestamp={new Date(m.at).toLocaleTimeString()}
        senderName={m.sender?.displayName}
        senderIdentity={m.sender?.handle}
        senderAvatarUri={avatar}
        showSender={group}
        receipt={m.receipt ?? undefined}
        receiptPending={!!m.pending}
        quote={
          m.quote
            ? {
                senderName: "Reply",
                excerpt: m.quote.deleted
                  ? "This message was deleted"
                  : m.quote.text,
              }
            : undefined
        }
        onPressQuote={onJump}
        onPressLink={Linking.openURL}
        mediaUri={video ? poster : photo}
        mediaKind={m.kind === "image" || m.kind === "video" ? m.kind : undefined}
        edited={m.edited}
        deleted={m.deleted}
        reactions={m.deleted ? [] : m.reactions}
        onPressReactionChip={react}
        accentColor={accent}
        viewOnce={!!m.oncePhoto}
        viewOnceOpened={opened || m.viewed}
        onPressMedia={async () => {
          if (m.oncePhoto) {
            const asset = await client.asset(m.oncePhoto.id);
            if ("denied" in asset) {
              setError(asset.denied.message);
              setOpened(true);
              return;
            }
            setOnceAsset(asset);
            setOpened(true);
            await client.mutate(api.features.opened, { messageId: m.id });
          }
          setShow(true);
        }}
      />
      {!m.deleted && m.kind === "poll" && <Poll messageId={m.id} accent={accent} />}
      {!m.deleted && (
        <View style={{ flexDirection: "row", paddingHorizontal: 18, gap: 6 }}>
          <Button testID="sm-convo-quote" onPress={onReply}>
            Reply
          </Button>
          <Button testID="sm-convo-react" onPress={() => setReacting(true)}>
            React
          </Button>
          {own && m.kind !== "poll" && Date.now() <= m.at + windows.editWindowSeconds * 1000 && (
            <Button testID="sm-convo-edit" onPress={onEdit}>
              Edit
            </Button>
          )}
          {own &&
            Date.now() <=
              m.at + windows.deleteForEveryoneWindowSeconds * 1000 && (
              <Button
                testID="sm-convo-delete"
                onPress={async () => {
                  const w = await client.mutate(api.media.delete, {
                    messageId: m.id,
                  });
                  if (w.state === "failed") setError(w.why.message);
                }}
              >
                Delete
              </Button>
            )}
        </View>
      )}
      {reacting && (
        <View>
          <ReactionPicker
            selectedEmoji={myEmoji}
            onPick={react}
            onDismiss={() => setReacting(false)}
          />
          <TextInput
            value={custom}
            onChangeText={setCustom}
            placeholder="Any emoji"
          />
          <Button onPress={() => custom && react(custom)}>Use emoji</Button>
        </View>
      )}
      {show && !m.deleted && (
        <Modal
          visible={true}
          transparent
          onRequestClose={() => {
            setShow(false);
            onceAsset?.revoke();
            setOnceAsset(null);
          }}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: "#111e",
              justifyContent: "center",
              padding: 30,
            }}
          >
            <Button
              testID="sm-media-viewer-close"
              onPress={() => {
                setShow(false);
                onceAsset?.revoke();
                setOnceAsset(null);
              }}
            >
              Close
            </Button>
            {video ? (
              <Video uri={video} />
            ) : (
              <Image
                testID="sm-media-viewer-image"
                source={{ uri: onceAsset?.url ?? photo }}
                style={{ height: 400, width: "100%" }}
                resizeMode="contain"
              />
            )}
          </View>
        </Modal>
      )}
    </View>
  );
}
export function ChatSettings({ id }: { id: string }) {
  const { client, setError, error } = useApp();
  const cr = useQuery(api.chat.conversation, { conversationId: id }),
    rr = useQuery(api.chat.roster, { conversationId: id });
  const [search, setSearch] = useState("d"),
    [adding, setAdding] = useState(false);
  const people = useQuery(api.people, { q: search });
  const c = "data" in cr ? cr.data : null;
  const members = "data" in rr ? rr.data : [];
  const admin =
    members.find((x) => x.principal === client.viewer())?.role === "admin";
  const background = useURI(c?.background?.id);
  const [name, setName] = useState(""),
    [description, setDescription] = useState("");
  useEffect(() => {
    setName(c?.name ?? "");
    setDescription(c?.description ?? "");
  }, [c?.name, c?.description]);
  async function customize(patch: any) {
    const w = await client.mutate(api.features.customize, {
      conversationId: id,
      ...patch,
    });
    if (w.state === "failed") setError(w.why.message);
  }
  async function pickBackground() {
    const p = await Picker.launchImageLibraryAsync({ mediaTypes: ["images"] });
    if (p.canceled) return;
    const u = await client.upload(
      await (await fetch(p.assets[0].uri)).arrayBuffer(),
    );
    if (!u.ok) {
      setError(u.why.message);
      return;
    }
    await customize({ background: { id: u.asset.id } });
  }
  async function action(principal: string, a: string) {
    const p =
      members.find((x) => x.profile?.handle === principal)?.principal ??
      ("data" in people
        ? people.data.find((x) => x.handle === principal)?.principal
        : principal);
    const w = await client.mutate(api.chat.member, {
      conversationId: id,
      principal: p,
      action: a,
    });
    if (w.state === "failed") setError(w.why.message);
  }
  return (
    <Shell>
      <ScrollView>
        <Button onPress={() => router.push("/conversation/id/" + id)}>
          Back to conversation
        </Button>
        {adding && (
          <TextInput
            placeholder="Find members"
            value={search}
            onChangeText={setSearch}
          />
        )}
        <Text testID="sm-chatsettings-message-count" accessibilityValue={{text: String(c?.messageCount ?? 0)}} aria-valuetext={String(c?.messageCount ?? 0)}>Messages: {c?.messageCount ?? 0}</Text>
        <ChatSettingsForm
          isGroup={c?.kind === "group"}
          canEdit={admin}
          name={name}
          onChangeName={setName}
          description={description}
          onChangeDescription={setDescription}
          selectedAccentColor={c?.color ?? "#4F46E5"}
          onSelectAccentColor={(color) => customize({ color: color.value })}
          backgroundUri={background}
          onPressBackground={pickBackground}
          disappearing={c?.disappearing ?? "off"}
          onSelectDisappearing={(disappearing) => customize({ disappearing })}
          members={members.map((m) => ({
            id: m.profile?.handle ?? m.principal,
            name: m.profile?.displayName ?? m.principal,
            admin: m.role === "admin",
          }))}
          onRemoveMember={(p) => action(p, "remove")}
          onPromoteMember={(p) => action(p, "promote")}
          onPressAddMember={() => setAdding(!adding)}
          addableMembers={
            adding && "data" in people
              ? people.data
                  .filter(
                    (p) => !members.some((m) => m.principal === p.principal),
                  )
                  .map((p) => ({ id: p.handle, name: p.displayName }))
              : []
          }
          onAddMember={(p) => action(p, "add")}
          onPressLeave={async () => {
            const w = await client.mutate(api.chat.leave, {
              conversationId: id,
            });
            if (w.state === "failed") setError(w.why.message);
            else router.replace("/chats");
          }}
          errorText={error}
        />
        {c?.kind === "group" && admin && (
          <Button onPress={() => customize({ name, description })}>
            Save name and description
          </Button>
        )}
      </ScrollView>
    </Shell>
  );
}
