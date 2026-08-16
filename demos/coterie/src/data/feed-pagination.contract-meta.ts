import { defineContractModule, pure, shape } from '@exact/contract/exports';

export default defineContractModule('./feed-pagination.ts', {
  createCoterieFeedState: pure({ params: [], result: 'CoterieFeedState', depends: 'args' }),
  reduceCoterieFeedState: pure({
    params: ['state', 'transition'],
    result: 'CoterieFeedState',
    depends: 'args',
  }),
  appendFeedRows: pure({ params: ['accumulated', 'page'], result: 'object[]', depends: 'args' }),
  feedNextCursor: pure({ params: ['rows'], result: 'string | null', depends: 'args' }),
  recordLikePatch: pure({ params: ['patches', 'postId', 'liked'], result: 'object[]', depends: 'args' }),
  recordRepostPatch: pure({
    params: ['patches', 'postId', 'reposted', 'viewerId'],
    result: 'object[]',
    depends: 'args',
  }),
  resetFeedPaginationState: pure({ params: [], result: 'FeedPaginationReset', depends: 'args' }),
  shouldCommitFeedPage: pure({
    params: ['cursor', 'appendedCursor'],
    result: 'boolean',
    depends: 'args',
  }),
  shouldAdvanceFeedCursor: pure({
    params: ['cursor', 'nextCursor'],
    result: 'boolean',
    depends: 'args',
  }),
  visibleFeedRows: pure({
    params: ['head', 'accumulated', 'currentPage', 'patches'],
    result: 'object[]',
    depends: 'args',
  }),
  FeedPaginationReset: shape({
    fields: {
      cursor: 'null',
      appendedCursor: 'null',
      rows: 'object[]',
      patches: 'object[]',
    },
  }),
  CoterieFeedState: shape({
    fields: {
      generation: 'number',
      feedTab: 'string',
      cursor: 'string | null',
      inFlightCursor: 'string | null',
      appendedCursor: 'string | null',
      readyPageCursor: 'string | null',
      readyPageRows: 'object[]',
      readyPageNextCursor: 'string | null',
      accumulatedRows: 'object[]',
      liveHeadRows: 'object[]',
      patches: 'object[]',
      composeText: 'string',
      composeResetFlip: 'boolean',
      email: 'string',
      password: 'string',
      authError: 'string',
    },
  }),
});
