import { describe, expect, it } from 'bun:test';

import {
  COTERIE_AVATAR_REFS,
  coterieAvatarOptions,
  coterieAvatarRefForSourceDigest,
  coterieAvatarUrlForRef,
} from '../src/data/avatar-refs.ts';

describe('Coterie avatar vocabulary', () => {
  it('projects picker metadata and served URLs from the canonical table', () => {
    const options = coterieAvatarOptions(COTERIE_AVATAR_REFS);

    expect(options).toHaveLength(COTERIE_AVATAR_REFS.length);
    for (const option of options) {
      expect(coterieAvatarUrlForRef(option.value)).toBe(option.url);
    }
    expect(coterieAvatarRefForSourceDigest(
      '283773fb9ae8f07a00e335fdd37fd9f836845594d8be3352ee0fab542c4c9984',
    )).toBe('media/avatar-alice.png');
    expect(coterieAvatarRefForSourceDigest(
      '9b49a333e2841ea99f6a708bc098a967d473183c134b5de9f35b6c36a72544d5',
    )).toBe('media/avatar-bob.png');
    expect(coterieAvatarRefForSourceDigest('0'.repeat(64))).toBeNull();
    expect(coterieAvatarRefForSourceDigest(null)).toBeNull();
  });

  it('leaves null and unknown refs without a selected picker option', () => {
    const undeclaredRef = 'media/avatar-intruder.png';
    const options = coterieAvatarOptions(COTERIE_AVATAR_REFS);
    const selectedOptions = (currentAvatarRef: string | null) =>
      options.filter((option) => option.value === currentAvatarRef);

    expect(coterieAvatarOptions([undeclaredRef])).toEqual([]);
    expect(coterieAvatarUrlForRef(undeclaredRef)).toBeNull();
    expect(selectedOptions(null)).toEqual([]);
    expect(selectedOptions(undeclaredRef)).toEqual([]);
  });
});
