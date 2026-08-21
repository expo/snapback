import {
  bind,
  defineSurface,
  param,
  v,
} from '@expo/snapback-codegen/define';

import { typing } from './surface-model.mjs';

export const typingRoom = defineSurface({
  params: { roomId: v.string() },
  presence: {
    typing: bind(typing, {
      scope: { roomId: param('roomId') },
    }),
  },
});
