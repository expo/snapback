import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { renderScaffoldAuthoringSkill } from './index.mjs';

// @ref LLP 0259#4-firstreadprofilev1--budget-the-bytes-the-carrier-sends — consumer skill must fit the per-skill steering budget.
const MAX_SKILL_BODY_BYTES = 10 * 1024;

test('scaffolded snapback-authoring skill fits the consumer steering budget', () => {
  const canonical = readFileSync(
    new URL('../../skills/snapback-authoring/SKILL.md', import.meta.url),
    'utf8',
  );
  const rendered = renderScaffoldAuthoringSkill(canonical);

  assert.ok(
    Buffer.byteLength(rendered, 'utf8') <= MAX_SKILL_BODY_BYTES,
    `rendered snapback-authoring skill exceeds ${MAX_SKILL_BODY_BYTES} bytes`,
  );
});
