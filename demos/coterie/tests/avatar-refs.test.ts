import { describe, expect, it } from 'bun:test';

import {
  COTERIE_AVATAR_REFS,
  coterieAvatarOptions,
  coterieAvatarUrlForRef,
} from '../src/data/avatar-refs.ts';

describe('Coterie avatar vocabulary', () => {
  it('projects picker metadata and served URLs from the canonical table', () => {
    const options = coterieAvatarOptions(COTERIE_AVATAR_REFS);

    expect(options).toHaveLength(COTERIE_AVATAR_REFS.length);
    for (const option of options) {
      expect(coterieAvatarUrlForRef(option.value)).toBe(option.url);
    }
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
