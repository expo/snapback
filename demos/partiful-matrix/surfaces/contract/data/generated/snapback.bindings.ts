// GENERATED binding module — do not hand-edit (LLP 0373 phase 2; LLP 0179 §8.1).
// Source authority: provider-native declaration "snapback" partitime-provider-v1 (inputsHash 5e96f75eae7192af).
// Generator: generateFromDeclaration (@exact/contract). generatedAt: DETERMINISTIC.

/** OQ8: excess provider result fields are structurally permitted at the wire and projected away by this row type. */
export interface EventRow {
  _id: string;
  accent: string;
  description: string;
  emoji: string;
  hostId: string;
  hostName: string;
  location: string;
  startsAt: number;
  title: string;
}

/** OQ8: excess provider result fields are structurally permitted at the wire and projected away by this row type. */
export interface PostRow {
  _id: string;
  authorId: string;
  authorName: string;
  createdAt: number;
  eventId: string;
  message: string;
}

/** OQ8: excess provider result fields are structurally permitted at the wire and projected away by this row type. */
export interface RsvpRow {
  _id: string;
  eventId: string;
  guestName: string;
  status: string;
  userId: string;
}

export interface EventDetailsParams {
  eventId: string;
}
export type EventDetailsResult = Array<EventRow>;
export type EventDetailsError = never;
export type EventDetailsReceiptsPosture = 'promised';

export interface EventWallParams {
  eventId: string;
}
export type EventWallResult = Array<PostRow>;
export type EventWallError = never;
export type EventWallReceiptsPosture = 'promised';

export interface GuestListParams {
  eventId: string;
}
export type GuestListResult = Array<RsvpRow>;
export type GuestListError = never;
export type GuestListReceiptsPosture = 'promised';

export type ListEventsParams = Record<string, never>;
export type ListEventsResult = Array<EventRow>;
export type ListEventsError = never;
export type ListEventsReceiptsPosture = 'promised';

export interface CreateEventParams {
  accent: string;
  description: string;
  emoji: string;
  hostName: string;
  location: string;
  startsAt: number;
  title: string;
}
export type CreateEventError = never;
export type CreateEventReceiptsPosture = 'promised';

export interface PostMessageParams {
  authorName: string;
  eventId: string;
  message: string;
}
export type PostMessageError = never;
export type PostMessageReceiptsPosture = 'promised';

export interface RsvpParams {
  eventId: string;
  guestName: string;
  status: string;
}
export type RsvpError = never;
export type RsvpReceiptsPosture = 'promised';

export interface GeneratedQueryBinding {
  readonly kind: 'query';
  readonly name: string;
  /** Stable descriptor identity at rest (LLP 0179 §8.1: the manifest query name). */
  readonly descriptorId: string;
  readonly compatibilityToken: string;
  readonly resultKind: 'list' | 'single' | 'scalar';
}

export interface GeneratedMutationBinding {
  readonly kind: 'mutation';
  readonly name: string;
  readonly writes: readonly string[];
  readonly optimistic: boolean;
}

export interface GeneratedProviderLinks {
  eventDetails(args: EventDetailsParams): unknown;
  eventWall(args: EventWallParams): unknown;
  guestList(args: GuestListParams): unknown;
  listEvents(args: ListEventsParams): unknown;
  createEvent(args: CreateEventParams): unknown;
  postMessage(args: PostMessageParams): unknown;
  rsvp(args: RsvpParams): unknown;
}

let generatedProviderLinks: GeneratedProviderLinks | null = null;

export function configureGeneratedProviderLinks(next: GeneratedProviderLinks): void {
  generatedProviderLinks = next;
}

export function resetGeneratedProviderLinks(): void {
  generatedProviderLinks = null;
}

function requireGeneratedProviderLinks(): GeneratedProviderLinks {
  if (generatedProviderLinks === null) {
    throw new Error('Generated provider links for snapback are not configured');
  }
  return generatedProviderLinks;
}

export const eventDetails = (() => {
  const callable = (args: EventDetailsParams): unknown => requireGeneratedProviderLinks().eventDetails(args);
  Object.defineProperties(callable, {
    kind: { value: 'query' },
    name: { value: 'eventDetails' },
    descriptorId: { value: 'eventDetails' },
    compatibilityToken: { value: '1' },
    resultKind: { value: 'list' },
  });
  return callable as typeof callable & GeneratedQueryBinding;
})();

export const eventWall = (() => {
  const callable = (args: EventWallParams): unknown => requireGeneratedProviderLinks().eventWall(args);
  Object.defineProperties(callable, {
    kind: { value: 'query' },
    name: { value: 'eventWall' },
    descriptorId: { value: 'eventWall' },
    compatibilityToken: { value: '1' },
    resultKind: { value: 'list' },
  });
  return callable as typeof callable & GeneratedQueryBinding;
})();

export const guestList = (() => {
  const callable = (args: GuestListParams): unknown => requireGeneratedProviderLinks().guestList(args);
  Object.defineProperties(callable, {
    kind: { value: 'query' },
    name: { value: 'guestList' },
    descriptorId: { value: 'guestList' },
    compatibilityToken: { value: '1' },
    resultKind: { value: 'list' },
  });
  return callable as typeof callable & GeneratedQueryBinding;
})();

export const listEvents = (() => {
  const callable = (args: ListEventsParams): unknown => requireGeneratedProviderLinks().listEvents(args);
  Object.defineProperties(callable, {
    kind: { value: 'query' },
    name: { value: 'listEvents' },
    descriptorId: { value: 'listEvents' },
    compatibilityToken: { value: '1' },
    resultKind: { value: 'list' },
  });
  return callable as typeof callable & GeneratedQueryBinding;
})();

export const createEvent = (() => {
  const callable = (args: CreateEventParams): unknown => requireGeneratedProviderLinks().createEvent(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'createEvent' },
    writes: { value: ['events', 'rsvps'] },
    optimistic: { value: true },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const postMessage = (() => {
  const callable = (args: PostMessageParams): unknown => requireGeneratedProviderLinks().postMessage(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'postMessage' },
    writes: { value: ['posts'] },
    optimistic: { value: true },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const rsvp = (() => {
  const callable = (args: RsvpParams): unknown => requireGeneratedProviderLinks().rsvp(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'rsvp' },
    writes: { value: ['rsvps'] },
    optimistic: { value: true },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const bindings = {
  provider: 'snapback',
  declarationVersion: 'partitime-provider-v1',
  queries: { eventDetails, eventWall, guestList, listEvents },
  mutations: { createEvent, postMessage, rsvp },
} as const;
