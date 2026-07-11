// LLP 0052 Phase 0 only: a Vite-resolved lazy edge to Exact's dev reporter.
// The production/native startup graph never imports this module; the
// measurement runner requests it explicitly after the app is mounted.
export async function installUpdateEconomyReporter(): Promise<void> {
  await import('@exact/renderer/update-economy');
}
