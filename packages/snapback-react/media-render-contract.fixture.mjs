// Executable UI recipe for the split metadata/delivery state carried by
// MediaState. It intentionally returns a renderer-neutral view model so the
// same control gates apply to React DOM and React Native components.
//
// @ref LLP 0239#d5-one-media-projection-handles-empty-image-video-denial-and-refresh
export function mediaRenderWitness(state, { recipientState = 'activated' } = {}) {
  if (!state || typeof state !== 'object') throw new TypeError('state must be a MediaState');
  if (!['available', 'activated', 'consumed'].includes(recipientState)) {
    throw new TypeError('recipientState must be available, activated, or consumed');
  }
  const metadataReady = state.status !== 'empty';
  const deliveryReady = state.status === 'ready' || state.status === 'refreshing';
  const terminal = recipientState === 'consumed' || state.status === 'denied';
  const openable = recipientState === 'activated' && deliveryReady && !terminal;
  const retryable = state.status === 'unavailable' && !terminal;
  const control = terminal
    ? 'terminal'
    : recipientState === 'available' && metadataReady
      ? 'activate'
      : openable
        ? 'open'
        : retryable
          ? 'retry'
          : 'waiting';

  return Object.freeze({
    messageVisible: true,
    captionVisible: true,
    mediaStatus: state.status,
    metadataReady,
    kind: metadataReady ? state.media.kind : null,
    deliveryReady,
    openable,
    terminal,
    retryable,
    control,
    url: deliveryReady ? state.url : null,
  });
}
