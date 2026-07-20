export class SubscriptionScope {
  constructor(onChange = () => {}) {
    this.generation = 0;
    this.handles = new Set();
    this.disposedSubscriptions = 0;
    this.ignoredStaleUpdates = 0;
    this.closed = false;
    this.onChange = onChange;
  }

  renew() {
    if (this.closed) throw new Error('subscription scope is closed');
    this.generation += 1;
    for (const handle of this.handles) this.disposeHandle(handle);
    this.handles.clear();
    this.notify();
    return this.generation;
  }

  async watch(start, observer) {
    const generation = this.generation;
    const guardedObserver = (...args) => {
      if (this.closed || generation !== this.generation) {
        this.ignoredStaleUpdates += 1;
        this.notify();
        return;
      }
      observer(...args);
    };

    const handle = await start(guardedObserver);
    if (this.closed || generation !== this.generation) {
      this.disposeHandle(handle);
      this.notify();
      return null;
    }
    this.handles.add(handle);
    this.notify();
    return handle;
  }

  close() {
    if (this.closed) return;
    this.generation += 1;
    this.closed = true;
    for (const handle of this.handles) this.disposeHandle(handle);
    this.handles.clear();
    this.notify();
  }

  snapshot() {
    return {
      generation: this.generation,
      activeSubscriptions: this.handles.size,
      disposedSubscriptions: this.disposedSubscriptions,
      ignoredStaleUpdates: this.ignoredStaleUpdates,
      closed: this.closed,
    };
  }

  disposeHandle(handle) {
    try {
      handle?.dispose?.();
    } finally {
      this.disposedSubscriptions += 1;
    }
  }

  notify() {
    this.onChange(this.snapshot());
  }
}
