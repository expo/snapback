import { InboxScreen } from '@tandem/shared/inbox-screen';
import { backend } from '@/backend';

export default function InboxRoute() {
  return <InboxScreen backend={backend} />;
}
