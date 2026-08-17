import { describe, expect, it } from 'bun:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  checkSmVocabulary,
  extractFrozenSmIds,
} from '../scripts/check-sm-vocabulary.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const authorityPath = resolve(
  appRoot,
  '..',
  '..',
  'benchmarks/tools/social-messenger/CONTRACT.md',
);
const fixtures = resolve(appRoot, 'tests/fixtures/sm-vocabulary');

describe('Coterie frozen social-messenger vocabulary check', () => {
  it('fails pinned semantic misuses of frozen IDs', () => {
    const report = checkSmVocabulary({
      authorityPath,
      sourcePaths: [resolve(fixtures, 'misapplied-frozen-ids.contract')],
    });

    expect(report.ok).toBe(false);
    expect(report.errors.map((error) => error.code)).toEqual([
      'SM_TRENDING_ROW_COMPOSITION',
      'SM_CHAT_COLOR_SELECTED_STATE',
      'SM_CHAT_DISAPPEARING_VALUE',
      'SM_CONVO_FILE_ELEMENT',
      'SM_FILE_CHOOSER_ELEMENT',
      'SM_FILE_CHOOSER_ELEMENT',
      'SM_RENDERED_MEDIA_ELEMENT',
      'SM_INTERACTIVE_ACTION_ELEMENT',
    ]);
    expect(report.errors
      .filter((error) => error.code === 'SM_FILE_CHOOSER_ELEMENT')
      .map((error) => error.id)).toEqual([
      'sm-chatsettings-background',
      'sm-convo-attach',
    ]);
  });

  it('accepts multiline JSX with structural feed and linked chooser evidence', () => {
    const report = checkSmVocabulary({
      authorityPath,
      sourcePaths: [resolve(fixtures, 'legitimate-chooser.tsx')],
    });

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it('allows IDs outside the frozen authority vocabulary', () => {
    const report = checkSmVocabulary({
      authorityPath,
      sourcePaths: [resolve(fixtures, 'extensions-allowed.contract')],
    });

    expect(report.ok).toBe(true);
    expect(report.extensionIds).toEqual(['sm-auth-form', 'sm-feed-author']);
  });

  it('passes the current Coterie source tree', () => {
    const report = checkSmVocabulary({
      authorityPath,
      sourcePaths: [resolve(appRoot, 'src')],
    });

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.frozenIds).toContain('sm-trending-row');
  });

  it('derives the frozen vocabulary from the authority section only', () => {
    const authority = [
      '# Example',
      'sm-outside-before',
      '## Test IDs',
      '`sm-frozen-one`, `sm-frozen-two`',
      '## Versioning',
      'sm-outside-after',
    ].join('\n');

    expect([...extractFrozenSmIds(authority)]).toEqual(['sm-frozen-one', 'sm-frozen-two']);
  });

  it('extracts the exact real authority vocabulary without glob ghosts', () => {
    const report = checkSmVocabulary({ authorityPath, sourcePaths: [] });
    const insightTotals = report.frozenIds.filter((id) => id.startsWith('sm-insights-total'));

    // No exact-count pin: the authority is versioned and may legitimately
    // amend its Test IDs before the P3 freeze. The properties that matter
    // are pinned instead: no glob-token ghosts, and the concrete insights
    // totals extracted as themselves.
    expect(report.frozenIds.length).toBeGreaterThan(0);
    expect(report.frozenIds).not.toContain('sm-insights-total');
    expect(report.frozenIds.every((id) => !/[*?<>]/.test(id))).toBe(true);
    expect(insightTotals).toEqual([
      'sm-insights-total-followers',
      'sm-insights-total-following',
      'sm-insights-total-likes-received',
      'sm-insights-total-posts',
      'sm-insights-total-replies-received',
      'sm-insights-total-reposts-received',
    ]);
  });
});
