// @ref LLP 3000#publication-suite-under-contention — correctness fixtures use
// the runner's ordinary work allowance, not a throughput expectation.
export const FILE_STALL_FLOOR_MS = 15 * 60_000;
export const fixtureWorkMs = FILE_STALL_FLOOR_MS;
// Allow the bounded command group drain after the final invocation. These
// outer guards do not change intentional watchdog/deadline assertions.
export const fixtureTestMs = (commands = 1) => commands * fixtureWorkMs + 120_000;
