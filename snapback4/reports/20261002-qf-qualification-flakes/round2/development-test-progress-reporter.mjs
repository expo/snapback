// @ref LLP 3000#publication-suite-under-contention — only test lifecycle
// progress resets the independent watchdog. Console chatter is not progress.
import { tap } from 'node:test/reporters';
export default async function* reporter(source) {
  async function* observed() {
    for await (const event of source) {
      // dequeue is the real start; test:start can be held for TAP ordering.
      if (['test:dequeue', 'test:complete'].includes(event.type) && process.connected)
        process.send({ progress: event.type, name: event.data.name });
      yield event;
    }
  }
  yield* tap(observed());
}
