import { defineContractModule, pure, shape } from '@exact/contract/exports';

export default defineContractModule('./feed-text.ts', {
  linkifyPostBody: pure({
    params: ['body'],
    result: 'CoteriePostBodySegment[]',
    depends: 'args',
  }),
  CoteriePostBodySegment: shape({
    fields: {
      id: 'string',
      text: 'string',
      href: 'string | null',
      testId: 'string | null',
    },
  }),
});
