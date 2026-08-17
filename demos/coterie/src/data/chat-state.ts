export interface CoterieChatState {
  generation: number;
  typingIntentSequence: number;
  typingIntentActive: boolean;
  typingSettledSequence: number;
  typingSettledActive: boolean;
  messageText: string;
  messageResetFlip: boolean;
  quotedMessageId: string | null;
  quotedSenderName: string | null;
  quotedBodySnippet: string | null;
  reactionPickerMessageId: string | null;
  highlightedMessageId: string | null;
  groupName: string;
  groupDescription: string;
  selectedMemberIds: string[];
}

export type CoterieChatTransition =
  | { kind: 'set-message-text'; generation: number; value: string }
  | { kind: 'typing-intent-issued'; generation: number; active: boolean }
  | { kind: 'typing-intent-settled'; sequence: number; active: boolean; ok: boolean }
  | {
      kind: 'begin-reply';
      generation: number;
      messageId: string;
      senderName: string;
      bodySnippet: string;
    }
  | { kind: 'cancel-reply'; generation: number }
  | { kind: 'highlight-message'; generation: number; messageId: string }
  | { kind: 'toggle-reaction-picker'; generation: number; messageId: string }
  | { kind: 'reaction-settled'; generation: number; ok: boolean }
  | { kind: 'async-intent-began'; generation: number }
  | { kind: 'send-began'; generation: number }
  | {
      kind: 'send-settled';
      generation: number;
      ok: boolean;
      messageText: string;
      quotedMessageId: string | null;
      quotedSenderName: string | null;
      quotedBodySnippet: string | null;
    }
  | { kind: 'seed-group-creator'; generation: number; userId: string }
  | { kind: 'set-group-name'; generation: number; value: string }
  | { kind: 'set-group-description'; generation: number; value: string }
  | { kind: 'toggle-group-member'; generation: number; userId: string }
  | { kind: 'group-create-began'; generation: number; creatorId: string }
  | {
      kind: 'group-create-settled';
      generation: number;
      ok: boolean;
      groupName: string;
      groupDescription: string;
      selectedMemberIds: string[];
    };

export function createCoterieChatState(viewerId: string = ''): CoterieChatState {
  return {
    generation: 0,
    typingIntentSequence: 0,
    typingIntentActive: false,
    typingSettledSequence: 0,
    typingSettledActive: false,
    messageText: '',
    messageResetFlip: false,
    quotedMessageId: null,
    quotedSenderName: null,
    quotedBodySnippet: null,
    reactionPickerMessageId: null,
    highlightedMessageId: null,
    groupName: '',
    groupDescription: '',
    selectedMemberIds: viewerId ? [viewerId] : [],
  };
}

/**
 * The sole commit gate for route-owned conversation and group-draft state.
 * Draft settlements carry the generation captured by their initiating action.
 * Typing uses its own monotonic sequence within the conversation route: a stale
 * completion is inert, and the route republishes the latest reducer-owned intent.
 *
 * @ref LLP 0059#exposure-invariant — delayed work cannot publish predecessor
 * interaction state into a successor generation.
 * @ref LLP 0013#conflict-behavior — ephemeral state converges by reasserting the
 * latest intent rather than preserving intermediate publishes.
 */
export function reduceCoterieChatState(
  state: CoterieChatState,
  transition: CoterieChatTransition,
): CoterieChatState {
  if (transition.kind === 'typing-intent-settled') {
    return transition.ok &&
      transition.sequence === state.typingIntentSequence &&
      transition.active === state.typingIntentActive
      ? {
          ...state,
          typingSettledSequence: transition.sequence,
          typingSettledActive: transition.active,
        }
      : state;
  }

  if (transition.generation !== state.generation) return state;

  switch (transition.kind) {
    case 'set-message-text':
      return { ...state, generation: state.generation + 1, messageText: transition.value };
    case 'typing-intent-issued':
      return {
        ...state,
        typingIntentSequence: state.typingIntentSequence + 1,
        typingIntentActive: transition.active,
      };
    case 'begin-reply':
      return {
        ...state,
        generation: state.generation + 1,
        quotedMessageId: transition.messageId,
        quotedSenderName: transition.senderName,
        quotedBodySnippet: transition.bodySnippet,
      };
    case 'cancel-reply':
      return {
        ...state,
        generation: state.generation + 1,
        quotedMessageId: null,
        quotedSenderName: null,
        quotedBodySnippet: null,
      };
    case 'highlight-message':
      return {
        ...state,
        generation: state.generation + 1,
        highlightedMessageId: transition.messageId,
      };
    case 'toggle-reaction-picker':
      return {
        ...state,
        generation: state.generation + 1,
        reactionPickerMessageId:
          state.reactionPickerMessageId === transition.messageId
            ? null
            : transition.messageId,
      };
    case 'reaction-settled':
      return transition.ok ? { ...state, reactionPickerMessageId: null } : state;
    case 'async-intent-began':
      return { ...state, generation: state.generation + 1 };
    case 'send-began':
      return {
        ...state,
        generation: state.generation + 1,
        messageText: '',
        messageResetFlip: !state.messageResetFlip,
        quotedMessageId: null,
        quotedSenderName: null,
        quotedBodySnippet: null,
        reactionPickerMessageId: null,
      };
    case 'send-settled':
      return transition.ok
        ? state
        : {
            ...state,
            messageText: transition.messageText,
            messageResetFlip: !state.messageResetFlip,
            quotedMessageId: transition.quotedMessageId,
            quotedSenderName: transition.quotedSenderName,
            quotedBodySnippet: transition.quotedBodySnippet,
          };
    case 'seed-group-creator':
      return state.selectedMemberIds.includes(transition.userId)
        ? state
        : {
            ...state,
            generation: state.generation + 1,
            selectedMemberIds: [...state.selectedMemberIds, transition.userId],
          };
    case 'set-group-name':
      return { ...state, generation: state.generation + 1, groupName: transition.value };
    case 'set-group-description':
      return {
        ...state,
        generation: state.generation + 1,
        groupDescription: transition.value,
      };
    case 'toggle-group-member':
      return state.selectedMemberIds.includes(transition.userId)
        ? {
            ...state,
            generation: state.generation + 1,
            selectedMemberIds: state.selectedMemberIds.filter(
              (userId) => userId !== transition.userId,
            ),
          }
        : {
            ...state,
            generation: state.generation + 1,
            selectedMemberIds: [...state.selectedMemberIds, transition.userId],
          };
    case 'group-create-began':
      return {
        ...state,
        generation: state.generation + 1,
        groupName: '',
        groupDescription: '',
        selectedMemberIds: transition.creatorId ? [transition.creatorId] : [],
      };
    case 'group-create-settled':
      return transition.ok
        ? state
        : {
            ...state,
            groupName: transition.groupName,
            groupDescription: transition.groupDescription,
            selectedMemberIds: transition.selectedMemberIds,
          };
  }
}
