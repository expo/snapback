// Shared All Aboard first-useful-paint oracle (ENG-24386 follow-up).
//
// `scriptStartMs` is intentionally only a secondary diagnostic: static ESM
// dependencies load and evaluate before an entry module's body can record it.
// The budget therefore starts at the navigation response boundary, which is
// early enough to include renderer fetch/evaluation and late enough to avoid
// conflating the app proof with arbitrary server/network latency.

export function assertFirstBoardPaintBudget(timing, budgetMs) {
  for (const field of ['htmlReceivedMs', 'scriptStartMs', 'firstBoardPaintMs']) {
    if (typeof timing?.[field] !== 'number' || !Number.isFinite(timing[field])) {
      throw new Error(`${field} not recorded: ${JSON.stringify(timing)}`);
    }
  }
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new Error(`invalid first-paint budget ${JSON.stringify(budgetMs)}`);
  }

  const responseToBoardMs = timing.firstBoardPaintMs - timing.htmlReceivedMs;
  const codeToBoardMs = timing.firstBoardPaintMs - timing.scriptStartMs;
  if (!(responseToBoardMs >= 0 && responseToBoardMs < budgetMs)) {
    throw new Error(
      `first useful paint ${Math.round(responseToBoardMs)}ms after HTML response ` +
      `(budget ${budgetMs}ms; entry-body diagnostic ${Math.round(codeToBoardMs)}ms): ${JSON.stringify(timing)}`,
    );
  }
  return { responseToBoardMs, codeToBoardMs };
}
