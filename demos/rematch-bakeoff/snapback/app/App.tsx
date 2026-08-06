import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, SafeAreaView, Text, View } from 'react-native';
import { BackendProvider, useBackend } from './src/backend';
import { PERSONAS, type Persona } from './src/broker';
import { ChatScreen, ConversationListScreen, OfflineApp, PersonaBar } from './src/screens';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#111b21' }}>
      <View style={{ flex: 1, maxWidth: 560, width: '100%', alignSelf: 'center' }}>{children}</View>
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

function ConnectedApp({
  persona,
  onSwitch,
}: {
  persona: Persona;
  onSwitch: (persona: Persona) => void;
}) {
  const backend = useBackend(persona);
  const [conversationId, setConversationId] = useState<string | null>(null);

  if (backend.status === 'connecting') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#00a884" />
        <Text style={{ color: '#8696a0', marginTop: 12 }}>
          Signing in as {persona.name}…
        </Text>
      </View>
    );
  }
  if (backend.status === 'offline') {
    return <OfflineApp error={backend.error} />;
  }
  return (
    <BackendProvider state={backend} key={persona.handle}>
      <PersonaBar persona={persona} onSwitch={onSwitch} />
      {conversationId ? (
        <ChatScreen
          conversationId={conversationId}
          persona={persona}
          onBack={() => setConversationId(null)}
        />
      ) : (
        <ConversationListScreen persona={persona} onOpen={setConversationId} />
      )}
    </BackendProvider>
  );
}

export default function App() {
  const [persona, setPersona] = useState<Persona>(PERSONAS[0]);
  return (
    <Shell>
      <ConnectedApp key={persona.handle} persona={persona} onSwitch={setPersona} />
    </Shell>
  );
}
