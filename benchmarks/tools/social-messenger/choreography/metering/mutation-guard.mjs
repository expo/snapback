export const R3_CELL_WALL_CAP_CUSTODY_POISONED =
  "R3_CELL_WALL_CAP_CUSTODY_POISONED";

// @ref LLP 0295#r3-claim-eligible-wave — an operation that outlives wall-cap
// grace loses every mutation capability while the host lock remains held.
export function createCellMutationGuard() {
  let poison = null;
  return Object.freeze({
    poison(details = {}) {
      poison ??= Object.freeze({
        diagnostic: R3_CELL_WALL_CAP_CUSTODY_POISONED,
        ...details,
      });
      return poison;
    },
    assertMutationAllowed(operation = "cell mutation") {
      if (poison === null) return;
      const error = new Error(
        `${R3_CELL_WALL_CAP_CUSTODY_POISONED}: refused ${operation}; `
        + "the timed-out operation remains unsettled and custody is held for manual recovery",
      );
      error.name = "CellCustodyPoisonedError";
      error.code = R3_CELL_WALL_CAP_CUSTODY_POISONED;
      error.rootCauseClass = "cell-wall-cap-custody";
      error.poison = poison;
      throw error;
    },
    get poisonRecord() {
      return poison;
    },
  });
}

export const ALLOW_CELL_MUTATIONS = Object.freeze({
  assertMutationAllowed() {},
  get poisonRecord() { return null; },
});
