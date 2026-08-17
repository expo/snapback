import type { FeedItem } from './generated/coterie.types.ts';

export type FeedMutationPatch =
  | { kind: 'like'; postId: string; value: boolean }
  | { kind: 'repost'; postId: string; value: boolean; viewerId: string };

export interface FeedPaginationReset {
  cursor: null;
  appendedCursor: null;
  rows: FeedItem[];
  patches: FeedMutationPatch[];
}

export type CoterieFeedTab = 'following' | 'global';

export interface CoterieFeedState {
  generation: number;
  feedTab: CoterieFeedTab;
  cursor: string | null;
  inFlightCursor: string | null;
  appendedCursor: string | null;
  readyPageCursor: string | null;
  readyPageRows: FeedItem[];
  readyPageNextCursor: string | null;
  accumulatedRows: FeedItem[];
  liveHeadRows: FeedItem[];
  liveHeadDeliverySequence: number;
  patches: FeedMutationPatch[];
  composeText: string;
  composeImageRefs: string[];
  composeVideoRefs: string[];
  composeResetFlip: boolean;
  email: string;
  password: string;
  authError: string;
}

export type CoterieFeedTransition =
  | { kind: 'choose-feed'; generation: number; feedTab: CoterieFeedTab }
  | { kind: 'live-head-delivered'; generation: number; rows: readonly FeedItem[] }
  | { kind: 'request-older-page'; generation: number; requestedCursor: string | null }
  | {
      kind: 'older-page-delivered';
      generation: number;
      requestedCursor: string | null;
      rows: readonly FeedItem[];
      nextCursor: string | null;
    }
  | { kind: 'commit-older-page'; generation: number; requestedCursor: string | null }
  | { kind: 'discard-older-page'; generation: number; requestedCursor: string | null }
  | { kind: 'set-compose-text'; generation: number; value: string }
  | {
      kind: 'toggle-compose-media';
      generation: number;
      mediaRef: string;
      mediaKind: 'image' | 'video';
    }
  | {
      kind: 'remove-compose-media';
      generation: number;
      mediaRef: string;
      mediaKind: 'image' | 'video';
    }
  | { kind: 'publish-began'; generation: number }
  | { kind: 'publish-settled'; generation: number; ok: boolean }
  | {
      kind: 'like-settled';
      generation: number;
      ok: boolean;
      postId: string;
      liked: boolean;
    }
  | {
      kind: 'repost-settled';
      generation: number;
      ok: boolean;
      postId: string;
      reposted: boolean;
      viewerId: string;
    }
  | { kind: 'set-email'; generation: number; value: string }
  | { kind: 'set-password'; generation: number; value: string }
  | {
      kind: 'sign-in-settled';
      generation: number;
      ok: boolean;
      errorMessage: string;
      liveHeadDeliverySequenceAtBegin: number;
    }
  | {
      kind: 'sign-out-settled';
      generation: number;
      ok: boolean;
      liveHeadDeliverySequenceAtBegin: number;
    };

export function resetFeedPaginationState(): FeedPaginationReset {
  return { cursor: null, appendedCursor: null, rows: [], patches: [] };
}

export function createCoterieFeedState(): CoterieFeedState {
  return {
    generation: 0,
    feedTab: 'following',
    cursor: null,
    inFlightCursor: null,
    appendedCursor: null,
    readyPageCursor: null,
    readyPageRows: [],
    readyPageNextCursor: null,
    accumulatedRows: [],
    liveHeadRows: [],
    liveHeadDeliverySequence: 0,
    patches: [],
    composeText: '',
    composeImageRefs: [],
    composeVideoRefs: [],
    composeResetFlip: false,
    email: 'alice@example.com',
    password: 'Alice!Clique2026',
    authError: '',
  };
}

export function mergeFeedRows(
  ...pages: ReadonlyArray<readonly FeedItem[]>
): FeedItem[] {
  const seen = new Set<string>();
  const merged: FeedItem[] = [];
  for (const page of pages) {
    for (const row of page) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(row);
    }
  }
  return merged;
}

export function appendFeedRows(
  accumulated: readonly FeedItem[],
  page: readonly FeedItem[],
): FeedItem[] {
  return mergeFeedRows(accumulated, page);
}

export function feedNextCursor(rows: readonly FeedItem[]): string | null {
  return rows[0]?.nextCursor ?? null;
}

export function recordLikePatch(
  patches: readonly FeedMutationPatch[],
  postId: string,
  liked: boolean,
): FeedMutationPatch[] {
  return [...patches.filter((patch) => !(patch.kind === 'like' && patch.postId === postId)), {
    kind: 'like',
    postId,
    value: liked,
  }];
}

export function recordRepostPatch(
  patches: readonly FeedMutationPatch[],
  postId: string,
  reposted: boolean,
  viewerId: string,
): FeedMutationPatch[] {
  return [...patches.filter((patch) => !(patch.kind === 'repost' && patch.postId === postId)), {
    kind: 'repost',
    postId,
    value: reposted,
    viewerId,
  }];
}

export function applyFeedPatches(
  rows: readonly FeedItem[],
  patches: readonly FeedMutationPatch[],
): FeedItem[] {
  const likeByPost = new Map(
    patches.filter((patch) => patch.kind === 'like').map((patch) => [patch.postId, patch.value]),
  );
  const repostByPost = new Map(
    patches.filter((patch) => patch.kind === 'repost').map((patch) => [patch.postId, patch]),
  );

  return rows
    .filter((row) => {
      const repostPatch = repostByPost.get(row.postId);
      return !(
        repostPatch?.value === false
        && row.repostedByMe
        && row.repostedById === repostPatch.viewerId
      );
    })
    .map((row) => {
      const liked = likeByPost.get(row.postId);
      const reposted = repostByPost.get(row.postId)?.value;
      return {
        ...row,
        ...(liked === undefined
          ? {}
          : {
              likeCount: row.likeCount + (liked === row.likedByMe ? 0 : liked ? 1 : -1),
              likedByMe: liked,
            }),
        ...(reposted === undefined
          ? {}
          : {
              repostCount: row.repostCount
                + (reposted === row.repostedByMe ? 0 : reposted ? 1 : -1),
              repostedByMe: reposted,
            }),
      };
    });
}

export function visibleFeedRows(
  head: readonly FeedItem[],
  accumulated: readonly FeedItem[],
  currentPage: readonly FeedItem[],
  patches: readonly FeedMutationPatch[],
): FeedItem[] {
  return applyFeedPatches(mergeFeedRows(head, accumulated, currentPage), patches);
}

export function shouldCommitFeedPage(
  cursor: string | null,
  appendedCursor: string | null,
): boolean {
  return Boolean(cursor && cursor !== appendedCursor);
}

export function shouldAdvanceFeedCursor(
  cursor: string | null,
  nextCursor: string | null,
): boolean {
  return Boolean(cursor && nextCursor && nextCursor !== cursor);
}

function resetAccumulation(
  state: CoterieFeedState,
  overrides: Partial<CoterieFeedState> = {},
  retainLiveHeadRows = true,
): CoterieFeedState {
  // A stable query key does not guarantee another delivery after settlement,
  // so re-adopt its latest head while discarding pagination and overlays.
  return {
    ...state,
    generation: state.generation + 1,
    cursor: null,
    inFlightCursor: null,
    appendedCursor: null,
    readyPageCursor: null,
    readyPageRows: [],
    readyPageNextCursor: null,
    accumulatedRows: [],
    liveHeadRows: retainLiveHeadRows ? state.liveHeadRows : [],
    patches: [],
    ...overrides,
  };
}

/**
 * The sole commit gate for route-owned feed, compose, and auth state.
 * Every transition carries the generation at which its initiating work began;
 * a continuation from an older reset generation is structurally inert.
 */
export function reduceCoterieFeedState(
  state: CoterieFeedState,
  transition: CoterieFeedTransition,
): CoterieFeedState {
  if (transition.generation !== state.generation) return state;

  switch (transition.kind) {
    case 'choose-feed':
      return transition.feedTab === state.feedTab
        ? state
        : resetAccumulation(state, { feedTab: transition.feedTab }, false);

    case 'live-head-delivered': {
      const nextHead = mergeFeedRows(transition.rows);
      const nextIds = new Set(nextHead.map((row) => row.id));
      const displacedRows = state.liveHeadRows.filter((row) => !nextIds.has(row.id));
      // @ref LLP 0266#d10-acceptance-harness-direction-for-oq2 — an external
      // multi-client delivery shifts the head exactly like a local mutation;
      // retain its displaced boundary before installing the replacement.
      return {
        ...state,
        liveHeadRows: nextHead,
        liveHeadDeliverySequence: state.liveHeadDeliverySequence + 1,
        accumulatedRows: displacedRows.length === 0
          ? state.accumulatedRows
          : mergeFeedRows(displacedRows, state.accumulatedRows),
      };
    }

    case 'request-older-page': {
      const requestedCursor = transition.requestedCursor;
      if (!requestedCursor || state.inFlightCursor !== null) return state;
      if (requestedCursor === state.appendedCursor) return state;
      if (state.cursor !== null && state.cursor !== requestedCursor) return state;
      return { ...state, cursor: requestedCursor, inFlightCursor: requestedCursor };
    }

    case 'older-page-delivered': {
      const requestedCursor = transition.requestedCursor;
      if (!requestedCursor || requestedCursor !== state.inFlightCursor) return state;
      if (state.readyPageCursor !== null) return state;
      return {
        ...state,
        readyPageCursor: requestedCursor,
        readyPageRows: mergeFeedRows(transition.rows),
        readyPageNextCursor: transition.nextCursor,
      };
    }

    case 'commit-older-page': {
      const requestedCursor = transition.requestedCursor;
      if (!requestedCursor || requestedCursor !== state.inFlightCursor) return state;
      if (requestedCursor !== state.readyPageCursor) return state;

      const nextCursor = state.readyPageNextCursor;
      const advances = Boolean(
        nextCursor
        && nextCursor !== requestedCursor
        && nextCursor !== state.appendedCursor,
      );
      return {
        ...state,
        accumulatedRows: appendFeedRows(state.accumulatedRows, state.readyPageRows),
        appendedCursor: requestedCursor,
        cursor: advances ? nextCursor : requestedCursor,
        inFlightCursor: advances ? nextCursor : null,
        readyPageCursor: null,
        readyPageRows: [],
        readyPageNextCursor: null,
      };
    }

    case 'discard-older-page':
      return transition.requestedCursor !== null
        && transition.requestedCursor === state.inFlightCursor
        ? {
            ...state,
            inFlightCursor: null,
            readyPageCursor: null,
            readyPageRows: [],
            readyPageNextCursor: null,
          }
        : state;

    case 'set-compose-text':
      return { ...state, composeText: transition.value };

    case 'toggle-compose-media':
      if (transition.mediaKind === 'video') {
        return state.composeVideoRefs.includes(transition.mediaRef)
          ? { ...state, composeVideoRefs: [] }
          : { ...state, composeImageRefs: [], composeVideoRefs: [transition.mediaRef] };
      }
      if (state.composeImageRefs.includes(transition.mediaRef)) {
        return {
          ...state,
          composeImageRefs: state.composeImageRefs.filter(
            (mediaRef) => mediaRef !== transition.mediaRef,
          ),
        };
      }
      if (state.composeImageRefs.length >= 4) return state;
      return {
        ...state,
        composeImageRefs: [...state.composeImageRefs, transition.mediaRef],
        composeVideoRefs: [],
      };

    case 'remove-compose-media':
      return transition.mediaKind === 'video'
        ? {
            ...state,
            composeVideoRefs: state.composeVideoRefs.filter(
              (mediaRef) => mediaRef !== transition.mediaRef,
            ),
          }
        : {
            ...state,
            composeImageRefs: state.composeImageRefs.filter(
              (mediaRef) => mediaRef !== transition.mediaRef,
            ),
          };

    case 'publish-began':
      return {
        ...state,
        generation: state.generation + 1,
        composeText: '',
        composeImageRefs: [],
        composeVideoRefs: [],
        composeResetFlip: !state.composeResetFlip,
      };

    case 'publish-settled':
      return transition.ok ? resetAccumulation(state) : state;

    case 'like-settled':
      return transition.ok
        ? { ...state, patches: recordLikePatch(state.patches, transition.postId, transition.liked) }
        : state;

    case 'repost-settled':
      return transition.ok
        ? {
            ...state,
            patches: recordRepostPatch(
              state.patches,
              transition.postId,
              transition.reposted,
              transition.viewerId,
            ),
          }
        : state;

    case 'set-email':
      return { ...state, email: transition.value };

    case 'set-password':
      return { ...state, password: transition.value };

    case 'sign-in-settled':
      return transition.ok
        // @ref LLP 0059#exposure-invariant — only a head delivered after this
        // auth action began can be exposed as the successor session's data.
        ? resetAccumulation(
            state,
            { authError: '' },
            state.liveHeadDeliverySequence > transition.liveHeadDeliverySequenceAtBegin,
          )
        : { ...state, authError: transition.errorMessage };

    case 'sign-out-settled':
      return transition.ok
        ? resetAccumulation(
            state,
            { authError: '' },
            state.liveHeadDeliverySequence > transition.liveHeadDeliverySequenceAtBegin,
          )
        : state;
  }
}
