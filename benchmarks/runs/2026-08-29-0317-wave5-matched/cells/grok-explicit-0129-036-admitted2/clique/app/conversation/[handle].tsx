import { useLocalSearchParams } from 'expo-router';
import { ConversationView } from '../../src/ui/ConversationView';

export default function DmScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  return <ConversationView kind="dm" lookup={String(handle ?? '')} />;
}
