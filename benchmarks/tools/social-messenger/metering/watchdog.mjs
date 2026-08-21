import { capTokenCount, tokenCountsEqual } from "./counts.mjs";
import {
  ADVISORY_CAP_FAMILIES,
  assertCapFamily,
} from "./sources.mjs";
import { timestampMillis } from "./jsonl.mjs";

function stableString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function enforcementController(value) {
  if (
    value === null
    || typeof value !== "object"
    || typeof value.terminate !== "function"
  ) {
    throw new TypeError("an enforcementController with terminate(trip) is required");
  }
  stableString(value.id, "enforcementController.id");
  return value;
}

function validateAck(value) {
  if (value?.acknowledged !== true) {
    throw new Error("enforcement controller did not acknowledge termination");
  }
  timestampMillis(value.acknowledgedAt, "termination acknowledgement.acknowledgedAt");
  stableString(value.evidence, "termination acknowledgement.evidence");
  return Object.freeze({
    acknowledged: true,
    acknowledgedAt: value.acknowledgedAt,
    evidence: value.evidence,
  });
}

export class TokenCapEnforcedError extends Error {
  constructor(trip, acknowledgement) {
    super(`${trip.milestone} token cap tripped; no next model turn is permitted`);
    this.name = "TokenCapEnforcedError";
    this.code = "SOCIAL_MESSENGER_TOKEN_CAP_ENFORCED";
    this.trip = trip;
    this.acknowledgement = acknowledgement;
  }
}

export class TokenMeteringReconciliationError extends Error {
  constructor(reconciliation, trip = null) {
    super(
      `${reconciliation.milestone} live watchdog actual ${reconciliation.liveActualTokens} does not equal retained-tree actual ${reconciliation.retainedActualTokens}`,
    );
    this.name = "TokenMeteringReconciliationError";
    this.code = "SOCIAL_MESSENGER_TOKEN_METERING_DIVERGED";
    this.reconciliation = reconciliation;
    this.trip = trip;
  }
}

// @ref LLP 0201#d2--quantitative-instrument — a token-cap exhaustion charges
// the (cap family, milestone) token cap plus actual wall and is flagged
// capped-tokens. The driver must acknowledge termination before this gate can
// advance to a later milestone; lane-global turn identities never reset.
export class TokenCapWatchdog {
  #controller;

  #state = null;

  #seenTurns = new Map();

  #terminationPromise = null;

  constructor({ enforcementController: controller } = {}) {
    this.#controller = enforcementController(controller);
  }

  arm({ capFamily, milestone, tokenCap, startedAt, maxClockSkewMs = 0 }) {
    assertCapFamily(capFamily);
    if (!/^M[1-8]$/u.test(milestone)) {
      throw new TypeError("milestone must name M1 through M8");
    }
    if (this.#state !== null) {
      throw new Error("disarm and reconcile the current milestone before arming the next one");
    }
    if (!Number.isInteger(maxClockSkewMs) || maxClockSkewMs < 0) {
      throw new TypeError("maxClockSkewMs must be a non-negative integer");
    }
    if (ADVISORY_CAP_FAMILIES.has(capFamily)) {
      if (tokenCap !== null) {
        throw new TypeError(`${capFamily} must have tokenCap null`);
      }
      this.#state = {
        armed: false,
        reason: "cap-advisory-family",
        capFamily,
        milestone,
      };
      this.#terminationPromise = null;
      return this.state;
    }
    if (tokenCap === null) {
      this.#state = {
        armed: false,
        reason: "token-cap-unavailable",
        capFamily,
        milestone,
      };
      this.#terminationPromise = null;
      return this.state;
    }
    if (!Number.isInteger(tokenCap) || tokenCap < 0) {
      throw new TypeError("tokenCap must be a non-negative integer or null");
    }
    const armedAt = timestampMillis(startedAt, "watchdog startedAt");
    this.#state = {
      armed: true,
      reason: null,
      capFamily,
      milestone,
      tokenCap,
      armedAt,
      maxClockSkewMs,
      actualTokens: 0,
      tripped: false,
      trip: null,
      terminationAck: null,
      terminationError: null,
      reconciled: false,
      reconciliation: null,
      overshoot: {
        tokens: 0,
        turns: [],
      },
    };
    this.#terminationPromise = null;
    return this.state;
  }

  disarm() {
    if (this.#state?.tripped === true && this.#state.terminationAck === null) {
      throw new Error("cannot disarm before termination is acknowledged");
    }
    if (this.#state?.armed === true && this.#state.reconciled !== true) {
      throw new Error("cannot disarm before retained-tree token reconciliation");
    }
    const previous = this.state;
    this.#state = null;
    this.#terminationPromise = null;
    return previous;
  }

  #registerTurn(turn) {
    if (turn === null || typeof turn !== "object" || typeof turn.id !== "string") {
      throw new TypeError("usage turn must carry a stable string id");
    }
    const completedAtMs = timestampMillis(turn.completedAt, "usage turn.completedAt");
    const turnTokens = capTokenCount(turn.usage);
    if (turnTokens === null) {
      throw new TypeError("cap-bearing usage turns require input and output counts");
    }
    const previous = this.#seenTurns.get(turn.id);
    if (previous !== undefined) {
      if (!tokenCountsEqual(previous.usage, turn.usage)) {
        throw new RangeError(`usage turn ${turn.id} changed after its completed identity was seen`);
      }
      return { fresh: false, turnTokens, completedAtMs };
    }
    return { fresh: true, turnTokens, completedAtMs };
  }

  #trip({ actualTokens, observedAt, source }) {
    const observedAtMs = timestampMillis(observedAt, "usage turn.completedAt");
    const chargedWallSeconds = Math.max(0, (observedAtMs - this.#state.armedAt) / 1000);
    const trip = Object.freeze({
      type: "token-cap-exhausted",
      capFamily: this.#state.capFamily,
      milestone: this.#state.milestone,
      status: "capability-failure",
      tokenCap: this.#state.tokenCap,
      actualTokens,
      observedAt,
      source,
      enforcementController: this.#controller.id,
      charging: {
        chargedWallSeconds,
        chargedTokens: this.#state.tokenCap,
        flags: ["capped-tokens"],
      },
    });
    this.#state.tripped = true;
    this.#state.trip = trip;
    this.#requestTermination(trip);
    return trip;
  }

  #requestTermination(trip) {
    let requested;
    try {
      requested = this.#controller.terminate(trip);
    } catch (error) {
      requested = Promise.reject(error);
    }
    this.#terminationPromise = Promise.resolve(requested)
      .then(validateAck)
      .then((ack) => {
        this.#state.terminationAck = ack;
        return ack;
      })
      .catch((error) => {
        this.#state.terminationError = error.message;
        throw error;
      });
  }

  observe(turn, { inFlight = false } = {}) {
    if (this.#state === null || this.#state.armed !== true) return null;
    if (typeof inFlight !== "boolean") {
      throw new TypeError("observe inFlight must be boolean");
    }
    const { fresh, turnTokens, completedAtMs } = this.#registerTurn(turn);
    if (!fresh) return this.#state.tripped ? this.#state.trip : null;
    if (completedAtMs < this.#state.armedAt - this.#state.maxClockSkewMs) {
      throw new RangeError(
        `new usage turn ${turn.id} predates ${this.#state.milestone}'s armed boundary beyond the recorded clock skew`,
      );
    }
    if (this.#state.tripped && !inFlight) {
      throw new Error(
        `post-trip usage turn ${turn.id} was not attested in flight when the cap tripped`,
      );
    }
    this.#seenTurns.set(turn.id, { usage: { ...turn.usage }, turnTokens });

    this.#state.actualTokens += turnTokens;
    if (this.#state.tripped) {
      this.#state.overshoot.tokens += turnTokens;
      this.#state.overshoot.turns.push(Object.freeze({
        id: turn.id,
        completedAt: turn.completedAt,
        tokens: turnTokens,
      }));
      return this.#state.trip;
    }
    if (this.#state.actualTokens < this.#state.tokenCap) return null;

    return this.#trip({
      actualTokens: this.#state.actualTokens,
      observedAt: turn.completedAt,
      source: "live-watchdog",
    });
  }

  reconcileMilestone({ retainedTokens, terminalAt }) {
    if (this.#state === null || this.#state.armed !== true) {
      throw new Error("a cap-bearing milestone must be armed before reconciliation");
    }
    if (!Number.isInteger(retainedTokens) || retainedTokens < 0) {
      throw new TypeError("retainedTokens must be a non-negative integer");
    }
    timestampMillis(terminalAt, "retained-tree terminalAt");
    const reconciliation = Object.freeze({
      milestone: this.#state.milestone,
      liveActualTokens: this.#state.actualTokens,
      retainedActualTokens: retainedTokens,
      deltaTokens: retainedTokens - this.#state.actualTokens,
      terminalAt,
      matched: retainedTokens === this.#state.actualTokens,
    });
    this.#state.reconciliation = reconciliation;
    if (!reconciliation.matched) {
      let trip = this.#state.trip;
      if (!this.#state.tripped && retainedTokens >= this.#state.tokenCap) {
        this.#state.actualTokens = retainedTokens;
        trip = this.#trip({
          actualTokens: retainedTokens,
          observedAt: terminalAt,
          source: "retained-tree-reconciliation",
        });
      }
      throw new TokenMeteringReconciliationError(reconciliation, trip);
    }
    this.#state.reconciled = true;
    return reconciliation;
  }

  async waitForTermination() {
    if (this.#state?.tripped !== true || this.#terminationPromise === null) {
      throw new Error("the watchdog has no pending token-cap termination");
    }
    return this.#terminationPromise;
  }

  async beforeTurn() {
    if (this.#state?.tripped !== true) return;
    const acknowledgement = await this.waitForTermination();
    throw new TokenCapEnforcedError(this.#state.trip, acknowledgement);
  }

  async runTurn(modelTurn) {
    if (typeof modelTurn !== "function") throw new TypeError("modelTurn must be a function");
    await this.beforeTurn();
    const turn = await modelTurn();
    return { turn, trip: this.observe(turn, { inFlight: true }) };
  }

  get state() {
    if (this.#state === null) return null;
    const { armedAt: _armedAt, maxClockSkewMs: _maxClockSkewMs, overshoot, ...state } = this.#state;
    if (overshoot === undefined) return state;
    return {
      ...state,
      overshoot: { tokens: overshoot.tokens, turns: [...overshoot.turns] },
    };
  }
}
