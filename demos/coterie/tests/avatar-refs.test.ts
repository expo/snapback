import { describe, expect, it } from 'bun:test';

import {
  COTERIE_AVATAR_REFS,
  coterieAvatarOptions,
  coterieAvatarRefForUrl,
  coterieAvatarUrlForRef,
} from '../src/data/avatar-refs.ts';

describe('Coterie avatar vocabulary', () => {
  it('projects picker metadata and reverse lookup from the canonical table', () => {
    const options = coterieAvatarOptions(COTERIE_AVATAR_REFS);

    expect(options).toHaveLength(COTERIE_AVATAR_REFS.length);
    for (const option of options) {
      expect(coterieAvatarUrlForRef(option.value)).toBe(option.url);
      expect(coterieAvatarRefForUrl(option.url, COTERIE_AVATAR_REFS)).toBe(option.value);
    }
  });

  it('does not infer picker or admission metadata from filename-shaped values', () => {
    const undeclaredRef = 'media/avatar-intruder.png';
    const undeclaredUrl = '/assets/fixtures/avatar-intruder.png';

    expect(coterieAvatarOptions([undeclaredRef])).toEqual([]);
    expect(coterieAvatarUrlForRef(undeclaredRef)).toBeNull();
    expect(coterieAvatarRefForUrl(undeclaredUrl, [undeclaredRef])).toBeNull();
  });
});
