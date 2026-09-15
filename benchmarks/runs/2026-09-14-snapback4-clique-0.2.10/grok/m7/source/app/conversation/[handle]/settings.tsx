import { ChatSettingsForm, chatAccentList } from "@snapback-bench/social-ui";
import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useClient, useMutation, useQuery, useViewer } from "snapback4/react";
import { api } from "../../../src/api.generated";
import { useAssetUrl } from "../../../src/AssetMedia";
import { WebFileButton } from "../../../src/WebFile";
import { settle } from "../../../src/ops";

export default function DmSettings(): React.JSX.Element {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const viewer = useViewer();
  const profile = useQuery(api.profileByHandle, { handle: (handle ?? "").toLowerCase() });
  const other = profile && !("loading" in profile) && !("denied" in profile) ? profile.data : null;
  const dm = useQuery(api.dmWith, { other: other?.principal ?? viewer ?? "none" });
  const conversationId =
    dm && !("loading" in dm) && !("denied" in dm) && dm.data ? dm.data.conversationId : null;
  if (!conversationId) {
    return (
      <View style={{ padding: 24 }}>
        <Text>Loading…</Text>
      </View>
    );
  }
  return <DmSettingsBody conversationId={conversationId} />;
}

function DmSettingsBody({ conversationId }: { conversationId: string }): React.JSX.Element {
  const client = useClient();
  const convQ = useQuery(api.conversation, { conversationId });
  const update = useMutation(api.updateConversation);
  const [convRow, setConvRow] = useState<any | null>(null);
  const conv = convRow ?? (convQ && !("loading" in convQ) && !("denied" in convQ) ? convQ.data : null);
  const bg = useAssetUrl(conv?.background?.id);

  useEffect(() => {
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

  async function pickBackground(files: File[]) {
    const file = files[0];
    if (!file) return;
    const uploaded = await client.upload(await file.arrayBuffer());
    if (!uploaded.ok) return;
    await settle(client, api.updateConversation, { conversationId, background: { id: uploaded.asset.id } });
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#fff" }}>
      <WebFileButton testID="sm-chatsettings-background" accept="image/*" onFiles={(f) => void pickBackground(f)} />
      <ChatSettingsForm
        isGroup={false}
        canEdit
        messageCount={typeof conv?.messageCount === "number" ? conv.messageCount : undefined}
        selectedAccentColor={chatAccentList.find((c) => c.name === conv?.accent)?.value}
        onSelectAccentColor={(c) => void update.run({ conversationId, accent: c.name })}
        backgroundUri={bg}
        onPressBackground={() =>
          (document.getElementById("sm-chatsettings-background") as HTMLInputElement | null)?.click()
        }
        disappearing={conv?.disappearing ?? "off"}
        onSelectDisappearing={(s) => void update.run({ conversationId, disappearing: s })}
      />
    </ScrollView>
  );
}
