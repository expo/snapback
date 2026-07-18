const timeoutError = (label, timeoutMs, cause = undefined) => {
  const error = new Error(
    `RBAC acceptance exceeded its settlement deadline during ${label} after ${timeoutMs}ms`,
    cause === undefined ? undefined : { cause },
  );
  error.code = 'SNAPBACK_RBAC_ACCEPTANCE_TIMEOUT';
  return error;
};

/**
 * Owns every live-subscription creation from start through disposal.
 *
 * Deadlines are settlement-aware: expiry records the diagnostic, but never
 * abandons the underlying operation. A late success is registered first and
 * only then rejects with the timeout, so teardown can always join and dispose
 * it before auth/server resources close.
 */
export class OwnedLiveSubscriptions {
  #state = 'open';
  #tasks = new Set();
  #subscriptions = [];
  #closePromise = null;
  #disposalError = null;

  get size() {
    return this.#subscriptions.length;
  }

  start({ label, settlementDeadlineMs, create, dispose }) {
    if (this.#state !== 'open') {
      throw new Error('RBAC live-subscription creation is closed');
    }
    if (
      typeof label !== 'string'
      || label.length === 0
      || !Number.isSafeInteger(settlementDeadlineMs)
      || settlementDeadlineMs < 1
      || typeof create !== 'function'
      || typeof dispose !== 'function'
    ) {
      throw new TypeError('owned live-subscription creation is invalid');
    }
    let expired = false;
    let adopted = false;
    let adoptedValue;
    const adopt = (value) => {
      if (adopted) {
        throw new Error(`RBAC live-subscription creation adopted ${label} more than once`);
      }
      adopted = true;
      adoptedValue = value;
      // Adoption is deliberately synchronous. A create callback can register
      // the raw successful subscribe before fallible validation/ACK work, so
      // any later initialization failure still leaves teardown owning it.
      this.#subscriptions.push({ label, value, dispose });
      return value;
    };
    const timer = setTimeout(() => { expired = true; }, settlementDeadlineMs);
    timer.unref?.();
    const task = Promise.resolve()
      .then(() => create(adopt))
      .then((value) => {
        if (!adopted) adopt(value);
        if (value !== adoptedValue) {
          throw new Error(`RBAC live-subscription creation changed ${label} after adoption`);
        }
        if (expired) throw timeoutError(label, settlementDeadlineMs);
        return value;
      }, (error) => {
        if (expired) throw timeoutError(label, settlementDeadlineMs, error);
        throw error;
      })
      .finally(() => {
        clearTimeout(timer);
        this.#tasks.delete(task);
      });
    this.#tasks.add(task);
    // A caller can miss an await, but ownership cannot miss settlement. Keep
    // the exact creation task observed until the close join consumes it.
    void task.then(() => {}, () => {});
    return task;
  }

  async #settleStarted() {
    // A task removes itself only after its success has registered. Looping
    // makes this robust to microtask ordering around an already-settled task.
    while (this.#tasks.size > 0) {
      await Promise.allSettled([...this.#tasks]);
    }
  }

  disposeAll({ strict }) {
    // Disposal is terminal. Keeping this compatibility name linearized onto
    // close prevents a successful cleanup from racing a late start.
    return this.closeAndDispose({ strict });
  }

  closeAndDispose({ strict }) {
    if (typeof strict !== 'boolean') {
      throw new TypeError('owned live-subscription close requires a strict boolean');
    }
    if (this.#closePromise === null) {
      // Linearization point: no start can land after the close has begun.
      this.#state = 'closing';
      this.#closePromise = (async () => {
        try {
          await this.#settleStarted();
          const pending = this.#subscriptions.splice(0).reverse();
          const failed = [];
          for (const subscription of pending) {
            try {
              await subscription.dispose(subscription.value);
            } catch (error) {
              this.#disposalError ??= error;
              failed.push(subscription);
            }
          }
          // Failed disposals remain visible as owned residue, but are never
          // repeated by concurrent or later close callers. The acceptance
          // boundary escalates such residue to forced server teardown.
          this.#subscriptions.push(...failed.reverse());
        } finally {
          this.#state = 'closed';
        }
      })();
    }
    return this.#closePromise.then(() => {
      if (strict && this.#disposalError !== null) throw this.#disposalError;
    });
  }
}

const deadlineError = (deadlineMs) => {
  const error = new Error(`RBAC acceptance exceeded its terminal deadline after ${deadlineMs}ms`);
  error.code = 'SNAPBACK_RBAC_ACCEPTANCE_WATCHDOG';
  return error;
};

/**
 * Close both resources owned by one acceptance session exactly once.
 *
 * Teardown is best-effort across peers but never best-effort in its result:
 * both close operations run, and any failure remains observable by every
 * concurrent or later caller through the shared promise.
 */
export const closeAcceptanceSession = (session) => {
  if (
    session === null
    || typeof session !== 'object'
    || typeof session.client?.closeAuth !== 'function'
    || typeof session.coordinator?.close !== 'function'
  ) {
    throw new TypeError('RBAC acceptance session is invalid');
  }
  session.closePromise ??= (async () => {
    const failures = [];
    try {
      await session.client.closeAuth();
    } catch (error) {
      failures.push(error);
    }
    try {
      await session.coordinator.close();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, 'RBAC acceptance session teardown failed');
    }
  })();
  return session.closePromise;
};

/**
 * Owns the acceptance process deadline.
 *
 * Expiry first invokes real cancellation/teardown supplied by the caller. A
 * second, still-live timer is the terminal backstop while normal code keeps
 * joining that cancelled work. There is intentionally no Promise.race: work
 * either settles and is joined, or the isolated acceptance process exits.
 */
export class TerminalAcceptanceWatchdog {
  #state = 'armed';
  #expired = false;
  #deadlineTimer;
  #terminalTimer = null;
  #shutdownTask = null;
  #closePromise = null;
  #clock;
  #terminalGraceMs;
  #onDeadline;
  #onTerminal;
  #error;

  constructor({
    deadlineMs,
    terminalGraceMs,
    onDeadline,
    onTerminal,
    clock = globalThis,
  }) {
    if (
      !Number.isSafeInteger(deadlineMs)
      || deadlineMs < 1
      || !Number.isSafeInteger(terminalGraceMs)
      || terminalGraceMs < 1
      || typeof onDeadline !== 'function'
      || typeof onTerminal !== 'function'
      || typeof clock?.setTimeout !== 'function'
      || typeof clock?.clearTimeout !== 'function'
    ) {
      throw new TypeError('terminal acceptance watchdog configuration is invalid');
    }
    this.#clock = clock;
    this.#terminalGraceMs = terminalGraceMs;
    this.#onDeadline = onDeadline;
    this.#onTerminal = onTerminal;
    this.#error = deadlineError(deadlineMs);
    this.#deadlineTimer = this.#clock.setTimeout(() => this.#expire(), deadlineMs);
  }

  get expired() {
    return this.#expired;
  }

  trigger(error = this.#error) {
    if (!(error instanceof Error)) {
      throw new TypeError('terminal acceptance watchdog requires an Error');
    }
    if (this.#state !== 'armed') return false;
    this.#clock.clearTimeout(this.#deadlineTimer);
    this.#error = error;
    this.#expire();
    return true;
  }

  #expire() {
    if (this.#state !== 'armed') return;
    this.#expired = true;
    this.#state = 'expiring';
    this.#terminalTimer = this.#clock.setTimeout(() => {
      if (this.#state !== 'closed') {
        this.#state = 'terminal';
        this.#onTerminal(this.#error);
      }
    }, this.#terminalGraceMs);
    try {
      this.#shutdownTask = Promise.resolve(this.#onDeadline(this.#error));
    } catch (error) {
      this.#shutdownTask = Promise.reject(error);
    }
    void this.#shutdownTask.then(() => {}, () => {});
  }

  close() {
    if (this.#closePromise !== null) return this.#closePromise;
    this.#closePromise = (async () => {
      const terminalFailure = this.#expired ? this.#error : null;
      if (this.#state === 'armed') {
        this.#clock.clearTimeout(this.#deadlineTimer);
      }
      if (this.#shutdownTask !== null) {
        await Promise.allSettled([this.#shutdownTask]);
      }
      if (this.#terminalTimer !== null) this.#clock.clearTimeout(this.#terminalTimer);
      this.#state = 'closed';
      // Joining a graceful shutdown proves ownership, not success. Once the
      // process deadline fired, teardown must surface that latched failure so
      // a late clean shutdown cannot turn the acceptance command green.
      if (terminalFailure !== null) throw terminalFailure;
    })();
    return this.#closePromise;
  }
}
