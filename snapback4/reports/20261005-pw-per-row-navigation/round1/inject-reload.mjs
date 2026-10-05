import { registerHooks } from 'node:module';
registerHooks({load(url, context, next) {
  const result = next(url, context);
  if (url.endsWith('/test/per-row-react.test.mjs')) {
    let source = String(result.source);
    const needle = '  const page = await browserFixture(t, rowsHarness);';
    if (source.split(needle).length !== 2) throw Error('review injection target changed');
    source = source.replace(needle, needle + `
  // Review fault injection: page code reloads after first mount, before original assertions.
  await page.waitForFunction(() => window.ready === 1000);
  const reviewNavigation = page.waitForEvent('framenavigated', {predicate: frame => frame === page.mainFrame()});
  await page.evaluate(() => { setTimeout(() => location.reload(), 25); });
  await reviewNavigation;
  t.diagnostic('REVIEW: unexpected page-code reload occurred after 1,000 hooks mounted');
`);
    return {...result, source};
  }
  return result;
}});
