import {
  defineEphemeral,
  defineSchema,
} from '@expo/snapback-codegen/define';

import { typing } from './surface-model.mjs';

export default defineSchema({}, {
  ephemeral: defineEphemeral({
    typing,
  }),
});
