export class BenchmarkPublicationError extends Error {
  constructor(reason, message, details = undefined) {
    super(message);
    this.name = 'BenchmarkPublicationError';
    this.reason = reason;
    this.details = details;
  }
}

export function fail(reason, message, details = undefined) {
  throw new BenchmarkPublicationError(reason, message, details);
}

export function formatFailure(error) {
  if (error instanceof BenchmarkPublicationError) {
    return `BENCHMARK_PUBLISHER_${error.reason}: ${error.message}`;
  }
  return `BENCHMARK_PUBLISHER_INTERNAL_ERROR: ${error?.stack ?? String(error)}`;
}
