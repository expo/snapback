import { capTokenCount } from "./counts.mjs";
import {
  ADVISORY_CAP_FAMILIES,
  assertCapFamily,
} from "./sources.mjs";
import { timestampMillis } from "./jsonl.mjs";

function nonNegativeNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative number`);
  }
  return value;
}

function wallAt(turn, armedAt) {
  if (armedAt === null) return null;
  const completedAt = timestampMillis(turn.completedAt, "usage turn.completedAt");
  return Math.max(0, (completedAt - armedAt) / 1000);
}

// @ref LLP 0201#d2--quantitative-instrument — a token-cap exhaustion charges
// the (cap family, milestone) token cap plus actual wall and is flagged
// capped-tokens; cache counters are observed but never enter the cap sum.
export class TokenCapWatchdog {
  #onTrip;

  #state = null;

  #turnTokens = new Map();

  constructor({ onTrip = () => {} } = {}) {
    if (typeof onTrip !== "function") {
      throw new TypeError("onTrip must be a function");
    }
    this.#onTrip = onTrip;
  }

  arm({ capFamily, milestone, tokenCap, startedAt = null }) {
    assertCapFamily(capFamily);
    if (!/^M[1-8]$/u.test(milestone)) {
      throw new TypeError("milestone must name M1 through M8");
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
      this.#turnTokens.clear();
      return this.state;
    }
    if (tokenCap === null) {
      this.#state = {
        armed: false,
        reason: "token-cap-unavailable",
        capFamily,
        milestone,
      };
      this.#turnTokens.clear();
      return this.state;
    }
    if (!Number.isInteger(tokenCap) || tokenCap < 0) {
      throw new TypeError("tokenCap must be a non-negative integer or null");
    }
    const armedAt = startedAt === null
      ? null
      : timestampMillis(startedAt, "watchdog startedAt");
    this.#state = {
      armed: true,
      reason: null,
      capFamily,
      milestone,
      tokenCap,
      armedAt,
      actualTokens: 0,
      tripped: false,
      trip: null,
    };
    this.#turnTokens.clear();
    return this.state;
  }

  disarm() {
    const previous = this.state;
    this.#state = null;
    this.#turnTokens.clear();
    return previous;
  }

  observe(turn, { wallSeconds } = {}) {
    if (this.#state === null || this.#state.armed !== true) return null;
    if (this.#state.tripped) return this.#state.trip;
    if (turn === null || typeof turn !== "object" || typeof turn.id !== "string") {
      throw new TypeError("usage turn must carry a stable string id");
    }
    const turnTokens = capTokenCount(turn.usage);
    if (turnTokens === null) {
      throw new TypeError("cap-bearing usage turns require input and output counts");
    }
    const previous = this.#turnTokens.get(turn.id) ?? 0;
    if (turnTokens < previous) {
      throw new RangeError(`usage turn ${turn.id} moved its cap counter backwards`);
    }
    this.#turnTokens.set(turn.id, turnTokens);
    this.#state.actualTokens += turnTokens - previous;
    if (this.#state.actualTokens < this.#state.tokenCap) return null;

    const chargedWallSeconds = wallSeconds === undefined
      ? wallAt(turn, this.#state.armedAt)
      : nonNegativeNumber(wallSeconds, "wallSeconds");
    const trip = Object.freeze({
      type: "token-cap-exhausted",
      capFamily: this.#state.capFamily,
      milestone: this.#state.milestone,
      status: "capability-failure",
      tokenCap: this.#state.tokenCap,
      actualTokens: this.#state.actualTokens,
      observedAt: turn.completedAt,
      charging: {
        chargedWallSeconds,
        chargedTokens: this.#state.tokenCap,
        flags: ["capped-tokens"],
      },
    });
    this.#state.tripped = true;
    this.#state.trip = trip;
    this.#onTrip(trip);
    return trip;
  }

  get state() {
    if (this.#state === null) return null;
    const { armedAt: _armedAt, ...state } = this.#state;
    return { ...state };
  }
}
