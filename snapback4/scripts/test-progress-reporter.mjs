// @ref LLP 3000#publication-suite-under-contention — observe native node --test
// in its parent process. No execution options or exit-status decisions live here.
import { tap } from 'node:test/reporters';

export default async function* reporter(source) {
  async function* observe() {
    for await (const event of source) {
      const { type, data } = event;
      if (process.connected) {
        if (type === 'test:dequeue' || type === 'test:complete')
          process.send({ progress: type, name: data.name });
        if (type === 'test:summary' && !data.file) {
          const { tests, passed: pass, failed: fail, cancelled, skipped, todo } = data.counts;
          process.send({ counts: { tests, pass, fail, cancelled, skipped, todo } });
        }
      }
      yield event;
    }
  }
  yield* tap(observe());
}
