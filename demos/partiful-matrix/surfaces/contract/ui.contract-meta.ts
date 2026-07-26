import { defineContractModule, pure, styleRecipe } from '@exact/contract/exports';

export default defineContractModule('./ui.ts', {
  backgroundFor: pure({ params: ['variant'], result: 'string', depends: ['palette'] }),
  textFor: pure({ params: ['variant'], result: 'string', depends: ['palette'] }),
  mutedFor: pure({ params: ['variant'], result: 'string', depends: ['palette'] }),
  accentFor: pure({ params: ['variant'], result: 'string', depends: ['palette'] }),
  surfaceStyle: styleRecipe({
    component: 'PartitimeSurface',
    params: ['variant', 'tone'],
    reads: ['Partitime.color.*'],
    outputs: {
      backgroundColor: { by: ['variant', 'tone'], via: 'surfaceStyle' },
      borderColor: { by: ['variant'], via: 'surfaceStyle' },
    },
  }),
  fieldStyle: styleRecipe({
    component: 'PartitimeField',
    params: ['variant', 'invalid'],
    reads: ['Partitime.color.*', 'invalid'],
    outputs: {
      backgroundColor: { by: ['variant'], via: 'fieldStyle' },
      borderColor: { by: ['variant', 'invalid'], via: 'fieldStyle' },
      color: { by: ['variant'], via: 'fieldStyle' },
    },
  }),
  requiredMessage: pure({ params: ['value', 'label'], result: 'string', depends: 'args' }),
});
