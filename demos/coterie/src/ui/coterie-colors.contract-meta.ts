import { defineContractModule, pure } from '@exact/contract/exports';

export default defineContractModule('./coterie-colors.ts', {
  contrastRatio: pure({ params: ['foreground', 'background'], result: 'number', depends: 'args' }),
  coterieAccentForeground: pure({ params: ['accent', 'scheme'], result: 'string', depends: 'args' }),
  coterieSwatchForeground: pure({ params: ['accent'], result: 'string', depends: 'args' }),
  coterieMessageBubbleFill: pure({ params: ['role', 'scheme'], result: 'string', depends: ['MESSAGE_BUBBLE_PALETTE'] }),
  coterieAvatarBackground: pure({ params: ['kind', 'accent', 'scheme'], result: 'string', depends: 'args' }),
  coterieAvatarForeground: pure({ params: ['kind', 'accent', 'scheme'], result: 'string', depends: 'args' }),
});
