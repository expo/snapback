export const COTERIE_PERSONA_IDS = [
  'alice',
  'bob',
  'carol',
  'dave',
  'erin',
  'frank',
  'grace',
  'henry',
] as const;

export type CoteriePersonaId = (typeof COTERIE_PERSONA_IDS)[number];

export const COTERIE_AVATAR_REFS = COTERIE_PERSONA_IDS.map(
  (personaId) => `media/avatar-${personaId}.png`,
) as readonly string[];

const avatarUrlByRef = new Map(
  COTERIE_PERSONA_IDS.map((personaId) => [
    `media/avatar-${personaId}.png`,
    `/assets/fixtures/avatar-${personaId}.png`,
  ]),
);

export function coterieAvatarUrlForRef(avatarRef: unknown): string | null {
  return typeof avatarRef === 'string' ? avatarUrlByRef.get(avatarRef) ?? null : null;
}

export const COTERIE_IMAGE_URLS = new Map<string, string>(
  Array.from({ length: 6 }, (_, index) => {
    const suffix = String(index + 1).padStart(2, '0');
    return [`media/img-${suffix}.png`, `/assets/fixtures/img-${suffix}.png`];
  }),
);

export const COTERIE_VIDEO_URLS = new Map<string, string>([
  ['media/vid-01.mp4', '/assets/fixtures/vid-01.mp4'],
]);
