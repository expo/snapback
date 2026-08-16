interface CoterieAvatarDefinition {
  id: string;
  label: string;
  value: string;
  url: string;
}

const COTERIE_AVATARS: readonly CoterieAvatarDefinition[] = [
  { id: 'alice', label: 'Alice avatar', value: 'media/avatar-alice.png', url: '/assets/fixtures/avatar-alice.png' },
  { id: 'bob', label: 'Bob avatar', value: 'media/avatar-bob.png', url: '/assets/fixtures/avatar-bob.png' },
  { id: 'carol', label: 'Carol avatar', value: 'media/avatar-carol.png', url: '/assets/fixtures/avatar-carol.png' },
  { id: 'dave', label: 'Dave avatar', value: 'media/avatar-dave.png', url: '/assets/fixtures/avatar-dave.png' },
  { id: 'erin', label: 'Erin avatar', value: 'media/avatar-erin.png', url: '/assets/fixtures/avatar-erin.png' },
  { id: 'frank', label: 'Frank avatar', value: 'media/avatar-frank.png', url: '/assets/fixtures/avatar-frank.png' },
  { id: 'grace', label: 'Grace avatar', value: 'media/avatar-grace.png', url: '/assets/fixtures/avatar-grace.png' },
  { id: 'henry', label: 'Henry avatar', value: 'media/avatar-henry.png', url: '/assets/fixtures/avatar-henry.png' },
];

export const COTERIE_AVATAR_REFS = COTERIE_AVATARS.map(
  (avatar) => avatar.value,
) as readonly string[];

const avatarByRef = new Map(COTERIE_AVATARS.map((avatar) => [avatar.value, avatar]));
const avatarByUrl = new Map(COTERIE_AVATARS.map((avatar) => [avatar.url, avatar]));

export interface CoterieAvatarOption {
  id: string;
  label: string;
  value: string;
  url: string;
}

export function coterieAvatarOptions(avatarRefs: readonly string[]): CoterieAvatarOption[] {
  return avatarRefs.flatMap((avatarRef) => {
    const avatar = avatarByRef.get(avatarRef);
    return avatar ? [{ ...avatar }] : [];
  });
}

export function coterieAvatarUrlForRef(avatarRef: unknown): string | null {
  return typeof avatarRef === 'string' ? avatarByRef.get(avatarRef)?.url ?? null : null;
}

export function coterieAvatarRefForUrl(
  avatarUrl: unknown,
  avatarRefs: readonly string[],
): string | null {
  if (typeof avatarUrl !== 'string') return null;
  const avatarRef = avatarByUrl.get(avatarUrl)?.value ?? null;
  return avatarRef !== null && avatarRefs.includes(avatarRef) ? avatarRef : null;
}
