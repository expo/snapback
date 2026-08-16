import assert from 'node:assert/strict';

import api from '../snapback/generated/api.mjs';
import { app } from '../snapback/generated/app.mjs';

assert.equal(api.listProfiles.kind, 'LiveQuery');
assert.equal(api.listPosts.kind, 'LiveQuery');
assert.equal(api.postMediaList.kind, 'LiveQuery');
assert.equal(app.commands.changeAvatar.kind, 'asset-bearing-command.v1');
assert.equal(app.commands.createPost.kind, 'media-command.v1');
assert.equal(app.commands.createPost.binding.media.input, 'media');
assert.equal(app.commands.createPost.binding.media.minItems, 0);
assert.equal(app.commands.createPost.binding.media.maxItems, 4);

for (const name of [
  'postMediaAppend',
  'postMediaReplace',
  'postMediaRemove',
  'postMediaReorder',
  'postMediaList',
]) {
  assert.equal(typeof api[name], 'object', `generated API contains ${name}`);
}

console.log('media-happy-post generated app smoke: projected commands and collection operations present');
