// GENERATED types — do not hand-edit (LLP 0373 phase 2; LLP 0179 §8.1).
// Source authority: provider-native declaration "convex" partitime-provider-v1 (inputsHash 29fc921cf137af79).
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
export type EventDetailsReceiptsPosture = 'none';

export interface EventWallParams {
  eventId: string;
}
export type EventWallResult = Array<PostRow>;
export type EventWallError = never;
export type EventWallReceiptsPosture = 'none';

export interface GuestListParams {
  eventId: string;
}
export type GuestListResult = Array<RsvpRow>;
export type GuestListError = never;
export type GuestListReceiptsPosture = 'none';

export type ListEventsParams = Record<string, never>;
export type ListEventsResult = Array<EventRow>;
export type ListEventsError = never;
export type ListEventsReceiptsPosture = 'none';

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
export type CreateEventReceiptsPosture = 'none';

export interface PostMessageParams {
  authorName: string;
  eventId: string;
  message: string;
}
export type PostMessageError = never;
export type PostMessageReceiptsPosture = 'none';

export interface RsvpParams {
  eventId: string;
  guestName: string;
  status: string;
}
export type RsvpError = never;
export type RsvpReceiptsPosture = 'none';
