import {
  type MediaCollectionItem,
  type MediaCommandDescriptorV1,
  type MediaCommandTask,
  type MediaState,
  type SnapbackReactProvider,
  invokeSnapbackCommand,
  useSnapbackCommand,
  useSnapbackMediaCollection,
  useSnapbackMutation,
} from './index.mjs';
import type { AssetFileLike } from '@expo/snapback-client/assets';
import type {
  GeneratedAppDescriptorV1 as MediaProfileAppDescriptor,
} from '../../tests/acceptance/fixtures/media-profile/snapback/generated/app.d.ts';
import type {
  Id,
  Principal,
} from '../../tests/acceptance/fixtures/media-profile/snapback/generated/api.d.ts';

export function MessageMedia({
  items,
}: {
  items: readonly MediaCollectionItem<'image' | 'video'>[];
}) {
  const projected = useSnapbackMediaCollection(items);
  return projected.map(({ itemId, state, refresh }) => {
    if (state.status === 'ready' || state.status === 'refreshing') {
      return { key: itemId, kind: state.media.kind, src: state.url };
    }
    if (state.status === 'unavailable') {
      return { key: itemId, retry: refresh };
    }
    return { key: itemId, hidden: true };
  });
}

export function useMessageMediaActions() {
  const sendMessage = useSnapbackCommand(mediaProfileApp.commands.sendMessage);
  const removeMessageMedia = useSnapbackMutation(
    mediaProfileApp.api.mutations.messageMediaRemove,
    { queue: false },
  );
  return {
    send(
      conversationId: string,
      text: string,
      media: readonly AssetFileLike[],
      recipients: readonly Principal[],
    ) {
      return sendMessage({ conversationId, text, media, recipients });
    },
    revoke(parentId: Id<'messages'>, itemIds: readonly string[]) {
      return removeMessageMedia({ parentId, itemIds });
    },
  };
}

declare const image: MediaCollectionItem<'image'>;
const imageState: MediaState<'image'> = useSnapbackMediaCollection([image])[0].state;
void imageState;
// @ts-expect-error collection items require stable generated item identity.
useSnapbackMediaCollection([{ ordinal: 0, media: image.media }]);

declare const mediaCommand: MediaCommandDescriptorV1;
declare const provider: SnapbackReactProvider;
declare const file: AssetFileLike;
const startMedia = useSnapbackCommand(mediaCommand);
const hookTask: MediaCommandTask<unknown> = startMedia({ media: [file] });
const imperativeTask: MediaCommandTask<unknown> = invokeSnapbackCommand(
  provider,
  mediaCommand,
  { media: file },
);
void hookTask;
void imperativeTask;

// Generated application command types must flow through the same React task
// projection without widening the media count or direct-recipient inputs.
declare const mediaProfileApp: MediaProfileAppDescriptor;
declare const recipient: Principal;
const createPost = useSnapbackCommand(mediaProfileApp.commands.createPost);
const postTask = createPost({ body: 'Four ordered items', media: [file, file, file, file] });
postTask.snapshot().items[0]?.ordinal.toFixed();
// @ts-expect-error createPost requires at least one media source.
createPost({ body: 'Missing media' });
// @ts-expect-error createPost accepts at most four media sources at runtime;
// the generated type still requires the one declared media input name.
createPost({ body: 'Wrong input', attachments: [file] });

const sendMessage = useSnapbackCommand(mediaProfileApp.commands.sendMessage);
const messageTask = sendMessage({
  conversationId: 'conversation-1',
  text: 'Three attachments',
  media: [file, file, file],
  recipients: [recipient],
});
messageTask.snapshot().progress.totalItems.toFixed();
// @ts-expect-error direct-recipient sharing requires its generated principal input.
sendMessage({ conversationId: 'conversation-1', text: 'No recipient', media: [file] });
