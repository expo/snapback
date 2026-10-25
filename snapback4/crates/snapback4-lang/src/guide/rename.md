# Rename a field or an enum value, end to end

A field rename preserves the same stored cell under a new name. Enum spelling
aliases carry values through release switches with reversible migration receipts.

```js
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deploy, rollback, startServe, cli } from "snapback4/proof";
const root = await mkdtemp(join(tmpdir(), "snapback4-rename-"));
const cwd = process.cwd();
let host;
try {
  process.chdir(root);
  const old = `table tickets:
  label: text <=80
  state: enum('queued', 'done')
  public 'rename example'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only
mutation add(label: text <=80):
  return insert tickets {label, state:'done'}
mutation edit(id: tickets, label: text <=80):
  return update tickets[id] {label, state:'queued'}
`;
  const current = old.replace("label: text <=80\n", "title: text <=80 renamed from label\n")
    .replaceAll("'done'", "'ready'")
    .replaceAll("label: text <=80)", "title: text <=80 alias label)")
    .replaceAll("{label,", "{title,") + "alias tickets.state 'done' = 'ready'\n";
  for (const [name, source] of [["v1", old], ["v2", current]]) {
    await mkdir(`versions/${name}`, { recursive:true });
    await writeFile(`versions/${name}/schema.q`, source);
  }
  const directory = join(root, "production");
  await deploy(directory, "versions/v1");
  host = await startServe(directory);
  const token = await host.operatorToken();
  async function write(op, args) {
    const response = await fetch(`${host.url}/m/${op}`, { method:"POST", headers:{"content-type":"application/json", authorization:`Bearer ${token}`}, body:JSON.stringify({args}), signal:AbortSignal.timeout(10000) });
    assert.equal(response.status, 200);
    const result = await response.json(); assert.equal(result.state, "sent"); return result.result;
  }
  async function rows() {
    const result = await cli(["data", "tickets", "--release", directory, "--json"]);
    assert.equal(result.code, 0, result.stderr);
    const page = JSON.parse(result.stdout); assert.equal(page.more, false);
    return new Map(page.rows.map(row => [row.id, row]));
  }
  const historical = await write("add", {label:"original"});
  await deploy(directory, "versions/v2");
  assert.equal((await rows()).get(historical.id).state, "ready");
  await write("edit", {id:historical.id, label:"edited"}); // old wire name still works
  const native = await write("add", {title:"new in v2"});
  for (let cycle = 0; cycle < 2; cycle++) {
    await rollback(directory, 1);
    const older = await rows();
    assert.equal(older.get(historical.id).label, "edited");
    assert.equal(older.get(historical.id).state, "queued");
    assert.equal(older.get(native.id).state, "done");
    await rollback(directory, "latest");
    const newer = await rows();
    assert.equal(newer.get(historical.id).title, "edited");
    assert.equal(newer.get(native.id).title, "new in v2");
    assert.equal(newer.get(native.id).state, "ready");
  }
  console.log("rename: historical and v2-native rows survive two cycles");
} finally {
  await host?.stop(); process.chdir(cwd);
  await rm(root, {recursive:true, force:true});
}
```

For a changed computation, retain its adopted backfill name and definition.
If a conflict reports competing values: keep a bridge that represents the
current data, repair through an authorized mutation, use a new name for new
meaning, preview both directions, then select the destination. Pruning cannot
reset a migration name. `rollback --check --bridge <new-dir>` writes source and
a checklist even when exact reverse extraction refuses several candidate children.

Use `title: text <=80 renamed from label`
for a scalar field, or `parent: orders renamed from order on delete cascade`
for a reference; the selected release supplies its delete policy and preserves
the existing parent lifetime. Keep the old operation argument with `alias label`
when it denotes the same input. An operation alias preserves a callable name;
it does not translate a result field or an enum argument.

`alias tickets.state 'done' = 'ready'` declares an injective enum spelling move.
The old spelling is absent from the current column's enum, and the new spelling
must be present. It lowers to ordinary named backfill/down receipts: existing
rows move forward, newer rows get a truthful old spelling on rollback, and edits
survive repeated cycles. It does not silently translate wire arguments. Retain
an explicit compatibility endpoint when frozen clients send old enum inputs.
Merging two business states needs an authored backfill and truthful `down`.

Save the example as `rename.mjs` beside an installed Snapback package and run
`node rename.mjs`. It uses a fresh temporary deployment, real persisted rows,
a service-authorized edit, and two rollback/forward cycles. It also checks a
v2-born row. Its temporary files and owned server are removed on completion.
