export class FixtureDescriptorError extends Error {
  code: string;
}

export type FixtureDescriptor = Record<string, unknown> & {
  protocol: 'clique-native/1';
  runId: string;
  queuedBodies: [string, string];
};

export function queuedBodiesForRun(runId: string): [string, string];
export function createFixtureDescriptor(
  fields: Record<string, unknown>,
  options?: { runId?: string },
): FixtureDescriptor;
export function validateFixtureDescriptor(
  descriptor: Record<string, unknown>,
  currentRunId: string,
): FixtureDescriptor;
