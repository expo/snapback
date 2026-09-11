type Closeable = {
  close(): void | Promise<void>;
};

export type JourneyCleanup = {
  clients: Iterable<Closeable>;
  epochClosed?: Promise<unknown>;
  providers: Iterable<Closeable>;
  removeStoreRoot?: () => Promise<void>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function settleCloses(closeables: Iterable<Closeable>, errors: unknown[]): Promise<void> {
  const results = await Promise.allSettled(
    [...closeables].map((closeable) => Promise.resolve().then(() => closeable.close())),
  );
  for (const result of results) {
    if (result.status === "rejected") errors.push(result.reason);
  }
}

/** Release every owner of a journey store before removing its directory. */
export async function cleanupJourney(cleanup: JourneyCleanup): Promise<unknown[]> {
  const errors: unknown[] = [];
  await settleCloses(cleanup.clients, errors);
  if (cleanup.epochClosed) {
    try {
      await cleanup.epochClosed;
    } catch (error) {
      errors.push(error);
    }
  }
  await settleCloses(cleanup.providers, errors);
  if (cleanup.removeStoreRoot) {
    try {
      await cleanup.removeStoreRoot();
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

export function journeyFailureMessage(primary: unknown, cleanupErrors: unknown[]): string {
  const cleanup = cleanupErrors.map(errorMessage);
  if (primary !== undefined) {
    const message = errorMessage(primary);
    return cleanup.length > 0
      ? `${message}; cleanup failed: ${cleanup.join("; ")}`
      : message;
  }
  return `cleanup failed: ${cleanup.join("; ")}`;
}
