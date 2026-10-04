import { readyRead } from "../dist/read-existence.js";
import test from "node:test";
import assert from "node:assert/strict";
import { Pages } from "../dist/react-pages.js";
import { ReadObservation } from "../dist/read-observation.js";
import { bindWatchPeek, observeWatch, observationKey } from "../dist/observe-watch.js";
const q = { kind: "query", name: "pages" };
const ready = (data, next) => (readyRead({ data, next, complete: true, cut: null, fresh: true }));
function fixture(t, op = q) {
  const watches = new Map();
  const client = { observe(op, args, options) {
    const key = observationKey(op, args, options);
    return observeWatch(watches, key, () => Object.assign(new ReadObservation(options?.keep), {
      key, subscribers: new Set(), presenceRefresh: null,
    }), watch => watch.publish(args.c ? ready(["b"], null) : ready(["a"], "second")), () => {}, () => null);
  } };
  bindWatchPeek(client, watches, () => null);
  const pages = new Pages(client, op, {}), stop = pages.subscribe(() => {});
  t.after(stop);
  const source = c => watches.get(observationKey(op, { c }));
  const notify = c => { for (const listener of source(c).subscribers) listener(); };
  return { pages, source, notify };
}

test("usePage follows ordered snapshots when an earlier event arrives after a later event", t => {
  const { pages, source, notify } = fixture(t, { kind: "query", name: "following", rowKey: "id" });
  const later = { id: "later", at: 2 }, earlier = { id: "earlier", at: 1 };
  source(null).publish(ready([later], null)); notify(null);
  assert.deepEqual(pages.getSnapshot().items, [later]);
  source(null).publish(ready([later, earlier], "second")); notify(null);
  pages.loadMore();
  source("second").publish(ready([earlier, { id: "old", at: 0 }], null)); notify("second");
  assert.deepEqual(pages.getSnapshot().items, [later, earlier, { id: "old", at: 0 }]);
  source(null).publish(ready([later, earlier], null)); notify(null);
  assert.deepEqual(pages.getSnapshot().items, [later, earlier]);
});
for (const page of [null, "second"]) test(`usePage checks ${page ?? "first"} page deadline before cached return without timer delivery`, t => {
  let now = 1000; t.mock.method(Date, "now", () => now);
  const { pages, source, notify } = fixture(t);
  pages.loadMore(); assert.deepEqual(pages.getSnapshot().items, ["a", "b"]);
  source(page).reload(true); notify(page);
  const held = pages.getSnapshot();
  assert.equal(held.read.revalidating, true); assert.equal(held.read.fresh, true);
  assert.equal(pages.getSnapshot(), held);
  now = 2000;
  const withdrawn = pages.getSnapshot();
  assert.notEqual(withdrawn, held);
  assert.deepEqual(withdrawn.items, page === null ? [] : ["a"]);
  assert.equal(withdrawn.read.revalidating, undefined);
  if (page === null) assert.deepEqual(withdrawn.read, { loading: true });
  else assert.deepEqual(withdrawn.read.data, ["a"]);
  assert.equal(pages.getSnapshot(), withdrawn, "cache stays Object.is stable after latching");
  now = 1000; assert.equal(pages.getSnapshot(), withdrawn);
});

test("usePage clears a later page's revalidating mark on replacement and replaces loaded cursors", t => {
  const { pages, source, notify } = fixture(t);
  pages.loadMore();
  source("second").reload(); notify("second");
  assert.equal(pages.getSnapshot().read.revalidating, true);
  source("second").publish(ready(["new b"], null)); notify("second");
  assert.deepEqual(pages.getSnapshot().items, ["a", "new b"]);
  assert.equal(pages.getSnapshot().read.revalidating, undefined);
  source(null).publish(ready(["new a"], "changed cursor")); notify(null);
  assert.deepEqual(pages.getSnapshot().items, ["new a", "b"], "old cursor's suffix is dropped");
  assert.equal(source("second"), undefined);
});

for (const name of ["search", "history"]) test(`usePage ${name} repeats keep one newest image by ID through page refresh`, t => {
  const { pages, source, notify } = fixture(t, { kind: "query", name, rowKey: "id" });
  source(null).publish(ready([{ id: "a", body: "old" }, { id: "b" }], "second")); notify(null);
  pages.loadMore();
  source("second").publish(ready([{ id: "a", body: "edited" }, { id: "c" }], null)); notify("second");
  assert.deepEqual(pages.getSnapshot().items, [{ id: "a", body: "edited" }, { id: "b" }, { id: "c" }]);
  assert.deepEqual(pages.getSnapshot().read.data, pages.getSnapshot().items);
  source(null).reload(); notify(null);
  assert.equal(pages.getSnapshot().items[0].body, "edited", "retaining an old image while revalidating does not make it newer");
  source(null).publish(ready([{ id: "a", body: "newest" }, { id: "b" }], "second")); notify(null);
  assert.equal(pages.getSnapshot().items[0].body, "newest", "earlier page refreshed after the suffix wins");
  assert.equal(pages.getSnapshot().items.length, 3);
  source("second").publish(ready([{ id: "a", body: "latest suffix" }, { id: "c" }], null)); notify("second");
  assert.equal(pages.getSnapshot().items[0].body, "latest suffix");
  source(null).publish(ready([{ id: "a", body: "restart" }], null)); notify(null);
  assert.deepEqual(pages.getSnapshot().items, [{ id: "a", body: "restart" }], "dropped suffix cannot resurrect an image");
});
