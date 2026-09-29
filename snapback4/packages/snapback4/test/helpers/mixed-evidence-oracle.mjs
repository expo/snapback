// Ported from LV 11af2c7d5. Authority comes only from fixture inputs: committed
// sync frames, injected failures and explicit sign-out, never emitted answers.
export function random(seed) { let state = seed; return n => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return (state >>> 8) % n; }; }
export class MixedModel {
  cut = 1;
  newest = 1;
  deadline;
  replacementFailed = false;
  signedOut = false;
  offlineSince;
  sawData = false;
  apply(cut, now) {
    if (cut <= this.cut) return;
    this.cut = cut;
    this.deadline = now + 1000;
    this.replacementFailed = false;
  }
  failed() { this.replacementFailed = true; }
  plain() { this.deadline = undefined; this.replacementFailed = false; }
  offline(confirmedAt) { this.offlineSince = confirmedAt; }
  signOut() { this.signedOut = true; }
  answer() { return this.cut % 2 ? `image-${this.cut}` : null; }
  observe(read, now) {
    if (this.signedOut) {
      if (!['E_AUTH', 'E_CLOSED'].includes(read.denied?.code)) throw Error('sign-out must publish its denial');
      return;
    }
    if (!('data' in read)) {
      if (read.loading && this.sawData && this.deadline === undefined) throw Error('loading after data without change evidence');
      return;
    }
    this.sawData = true;
    if (this.offlineSince !== undefined) {
      if (read.fresh !== false) throw Error('offline answer still fresh');
      if (read.since !== this.offlineSince) throw Error(`offline since ${read.since}, expected ${this.offlineSince}`);
    }
    if (read.data === null) {
      if (this.cut % 2 && !(read.revalidating && this.newest < this.cut && now < this.deadline)) throw Error('empty answer while fixture membership permits the row');
      return;
    }
    const image = Number(read.data.body.slice('image-'.length));
    if (!Number.isInteger(image) || image < this.newest || image > this.cut) throw Error(`older or unknown answer ${image}, newest ${this.newest}, fixture ${this.cut}`);
    if (this.cut % 2 === 0 && !(read.revalidating && !this.replacementFailed && now < this.deadline)) {
      throw Error(`visibility after membership removal at ${this.cut}, now ${now}, allowed until ${this.deadline}`);
    }
    this.newest = image;
  }
  check(read) {
    if (!('data' in read)) return;
    if (this.signedOut || (this.cut % 2 === 0 && read.data !== null)) throw Error(`visibility after membership removal at ${this.cut}`);
    if (this.cut % 2 && read.data === null) throw Error('empty direct answer while fixture membership permits the row');
    if (read.data !== null && read.data.body !== this.answer()) throw Error(`older answer: ${read.data.body}, expected ${this.answer()}`);
  }
}
