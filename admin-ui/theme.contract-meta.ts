// Contract descriptors for the admin theme helpers (LLP 0032 P8): the Exact
// compiler's opaque-import rule requires pure-context calls to carry a
// declared descriptor; every export here is a pure derivation over its args.
import { defineContractModule, pure } from '@exact/contract/exports';

export default defineContractModule('./theme.ts', {
  colors: pure({ params: ['mode'], result: 'AdminColors', depends: 'args' }),
  fonts: pure({ params: [], result: 'AdminFonts', depends: 'args' }),
  navSections: pure({ params: [], result: 'NavSection[]', depends: 'args' }),
  tabNames: pure({ params: [], result: 'string[]', depends: 'args' }),
  initialTab: pure({ params: [], result: 'string', depends: 'args' }),
  initialTheme: pure({ params: [], result: 'string', depends: 'args' }),
});
