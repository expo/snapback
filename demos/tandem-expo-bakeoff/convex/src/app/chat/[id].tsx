import { useLocalSearchParams } from 'expo-router';
import { ChatScreen } from '@tandem/shared/chat-screen';
import { backend } from '@/backend';

export default function ChatRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ChatScreen backend={backend} conversationId={id} />;
}
