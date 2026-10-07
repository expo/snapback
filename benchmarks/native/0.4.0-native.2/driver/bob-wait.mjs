import { messageRows } from './bob-dom.mjs';
export async function conversation(page, f, boundMs = 10000) {
 const deadline = performance.now() + boundMs;
 let rows = [], screen = [];
 do {
  rows = await page.getByTestId('sm-convo-bubble').evaluateAll(messageRows);
  screen = await page.locator('[data-conversation]').evaluateAll(ns => ns.map(n => ({conversationId:n.getAttribute('data-conversation'),principal:n.getAttribute('data-principal')})));
  if (screen.length === 1 && screen[0].conversationId === f.conversationId && screen[0].principal === f.bob && f.queuedBodies.every(body => rows.filter(r => r.body === body).length === 1)) return {rows, screen};
  await page.waitForTimeout(Math.min(100, Math.max(0, deadline-performance.now())));
 } while (performance.now() < deadline);
 return {rows, screen};
}
