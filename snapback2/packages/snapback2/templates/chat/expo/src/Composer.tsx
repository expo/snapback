import React, { useState } from "react";
import { Button, Text, TextInput, View } from "react-native";
import { api } from "snapback2/client";
import { useConnection, useMutation, useSnapbackClient, useSnapbackSnapshot } from "snapback2/react-native";
import type { SendUncertainty } from "../shared/offline.js";
import type { RecoveryCustody } from "../shared/recovery";
import { useSendController } from "../shared/send";

// @ref LLP 1018.000#8-account-sessions-and-durable-follower-admission — the
// stable Chat owner retains one lost answer through Thread → Inbox remounts.
export function Composer({ conversationId, custody }: {
  conversationId: string;
  custody?: RecoveryCustody<SendUncertainty>;
}) {
  const post = useMutation(api.deliveries.post);
  const client = useSnapbackClient();
  const generation = useSnapbackSnapshot().authGeneration;
  const [note, setNote] = useState("");
  const controller = useSendController({
    conversationId,
    client,
    generation,
    connection: useConnection(),
    post,
    custody,
    onNote: setNote,
  });
  return <View style={{ padding: 16 }}>
    <TextInput accessibilityLabel="Message" placeholder="Message" value={controller.body}
      onChangeText={controller.setBody} multiline />
    <Button title="Send" disabled={controller.busy || !post.ready || post.inFlight || !controller.body.trim()
      || controller.uncertainty !== undefined} onPress={() => { void controller.send(); }} />
    {controller.uncertainty ? <><Text accessibilityRole="alert">
      {controller.canRecover
        ? `Confirmation is unknown for “${controller.uncertainty.draft}” in ${controller.uncertainty.conversationId}.`
        : `Confirmation is unknown in ${controller.uncertainty.conversationId}. Return there to check the same send.`}
    </Text>{controller.canRecover ? <Button title={controller.busy ? "Checking…" : "Check send"}
      disabled={controller.busy} onPress={() => { void controller.recover(); }} /> : null}</> : null}
    {controller.status ? <Text accessibilityRole="text">{controller.status.message}</Text> : null}
    {controller.status?.canSync ? <Button title={controller.syncing ? "Syncing…" : "Sync now"}
      disabled={controller.syncing} onPress={() => { void controller.sync(); }} /> : null}
    {note ? <Text accessibilityRole="alert">{note}</Text> : null}
  </View>;
}
