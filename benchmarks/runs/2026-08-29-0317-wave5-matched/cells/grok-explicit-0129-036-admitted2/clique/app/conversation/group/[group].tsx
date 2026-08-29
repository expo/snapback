import { useLocalSearchParams } from 'expo-router';
import { ConversationView } from '../../../src/ui/ConversationView';

export default function GroupConversationScreen() {
  const { group } = useLocalSearchParams<{ group: string }>();
  return <ConversationView kind="group" lookup={String(group ?? '')} />;
}
