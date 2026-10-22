Decide evidence presence from the specification before wiring an upload. If a
photo must remain present, declare `invariant orders always .photo != null` on
the application's actual table and column. If presence is required only when
creating a row, use `invariant orders.insert only .photo != null` instead;
subsequent redaction can then remain intentional. The generated security draft
asks this question. An optional creating argument that contradicts this intent
requires an individual security review. A required photo on a separate child
does not require a child row: declare the parent's evidence requirement and its
permitted draft states too. Deliberately optional attachments stay advisory.

Uploads are bound to the uploader: the account that places an asset must upload
its bytes. One upload has one home; reusing it in another row refuses. To share
evidence, reference its original row rather than placing its asset again. Required
workflow evidence needs a required mutation argument as well as a required column;
a conditional child insertion does not require evidence on its parent.


## Placement replay: documents and one home

Save this complete schema as `snapback/schema.q`; run `npx snapback4 check`.
This local-only recipe tests ownership with personas on a disposable store.
Shared previews use real users via `guide staging`. Each intended copy uploads
fresh bytes as the account that places it. Shared evidence instead references
the original document row, whose current read rule still controls its bytes.

```quarry
use personas alice, bob
table documents:
  owner: principal
  scan: file <=10000 ('application/pdf')
  read <- .owner = viewer
  insert <- .owner = viewer
  online only
table copies:
  owner: principal
  source: documents
  read <- .owner = viewer
  insert <- .owner = viewer
  online only
mutation place(scan: file <=10000 ('application/pdf')):
  return insert documents {owner: viewer, scan}
mutation reference(source: documents):
  row = documents[source] ! else NOT_FOUND
  return insert copies {owner: viewer, source: row.id}
```

Save as `placements.mjs` beside snapback/; run `node placements.mjs` (Node 24).
The file hint selects document verification even when the bytes have a PDF
header. Image/video media omit it. Raw HTTP uploads can return HTTP 200 with
`{denied}`: inspect the envelope, or use the SDK as below. Upload succeeds with
`{ok:true,asset}`; download returns a URL handle or `{denied}`, never a Blob.

```js
import assert from "node:assert/strict";
import { startDev } from "snapback4/proof";
import { createClient } from "snapback4/client";
import { api } from "./snapback/generated/api.ts";
const host = await startDev({args:["--memory", "--no-watch"]});
const alice = createClient({url:host.url, persona:"alice"});
const bob = createClient({url:host.url, persona:"bob"});
try {
  const bytes = new TextEncoder().encode("%PDF-1.7\nexample\n%%EOF\n");
  const missingHint = await alice.upload(bytes);
  assert.equal(missingHint.ok, false);
  assert.match(missingHint.why.message, /file/);
  const uploaded = await alice.upload(bytes, {file:{name:"report.pdf", type:"application/pdf"}});
  assert.equal(uploaded.ok, true);
  const scan = {id:uploaded.asset.id};
  const first = await alice.mutate(api.place, {scan});
  assert.equal(first.state, "sent");
  const reused = await alice.mutate(api.place, {scan});
  assert.equal(reused.why.code, "E_ASSET_PLACED");
  const foreign = await bob.mutate(api.place, {scan});
  assert.equal(foreign.why.code, "E_ASSET_UNKNOWN");
  assert.equal((await alice.mutate(api.reference, {source:first.result.id})).state, "sent");
  const read = await alice.asset(scan.id);
  if ("denied" in read) throw Error(read.denied.message);
  try { assert.equal(read.type, "application/pdf"); } finally { read.revoke(); }
} finally { alice.close(); bob.close(); await host.stop(); }
```

Place an upload within one hour. Time travel also collects unplaced bytes:
advance first, sign in again if needed, then upload and place. Missing, foreign,
collected and hidden assets share E_ASSET_UNKNOWN; the refusal never reveals
another account or a hidden home's contents. A same-uploader E_ASSET_PLACED
names the upload's existing home. `client.assetSource(id)` carries auth headers
for native downloads; browser save-on-demand uses `saveAsset(client,id)`.
