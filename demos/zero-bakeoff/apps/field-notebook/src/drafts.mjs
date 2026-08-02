export class DraftStore {
  #store;
  constructor(store = new Map()) { this.#store = store; }
  save(recordId, body) { this.#store.set(recordId, String(body)); }
  load(recordId) { return this.#store.get(recordId) ?? null; }
  delete(recordId) { this.#store.delete(recordId); }
}
