// Ported from LV 11af2c7d5. The PRNG and independently released schedules
// survive; the reference is fixture history, not the SDK's admission algorithm.
export function random(seed) { let state = seed; return n => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return (state >>> 8) % n; }; }
export class MixedModel {
  cut = 1;
  newest = 1;
  removed = false;
  head = 1;
  observe(read) {
    if (!('data' in read)) return;
    if (read.data === null) { this.removed = true; return; }
    const image = Number(read.data.body.slice('image-'.length));
    if (image < this.newest) throw Error(`older answer ${image} over ${this.newest}`);
    if (this.removed && (this.head % 2 === 0 || image !== this.head)) throw Error(`visibility after membership removal at ${this.head}`);
    this.newest = image; this.removed = false;
  }
  answer() { return this.cut % 2 ? `image-${this.cut}` : null; }
  apply(cut) { this.cut = Math.max(this.cut, cut); }
  check(read) {
    if (!('data' in read)) return;
    if (this.cut % 2 === 0 && read.data !== null) throw Error(`visibility after membership removal at ${this.cut}`);
    if (read.data !== null && read.data.body !== this.answer()) throw Error(`older answer: ${read.data.body}, expected ${this.answer()}`);
  }
}
