Decide evidence presence from the specification before wiring an upload. In the
schema below, `invariant documents always .scan != null` states permanent presence.
Use `invariant documents.insert only .scan != null` for creation-only presence;
later redaction also needs a nullable column. The generated security draft asks
this question. An optional creating argument that contradicts this intent requires
an individual security review. A required photo on a separate child does not
require a child row: declare the parent's evidence requirement and its permitted
draft states too. Deliberately optional attachments stay advisory.

Uploads are bound to the uploader: the account that places an asset must upload
its bytes. One upload has one home; reusing it in another row refuses. To share
evidence, reference its original row rather than placing its asset again. Required
workflow evidence needs a required mutation argument as well as a required column;
a conditional child insertion does not require evidence on its parent.


## Copy the same image into several columns

One home means one table/row/**column**, even when two columns share a row.
The account placing the image must upload it; an operator cannot lend its upload
to a different user. Upload the selected bytes once per destination column.
Asset IDs are placement identities, not content hashes: the two uploads below
get distinct IDs. Shared bytes without separate placements should instead use
references to the original readable home row.

```js
// `client` is signed in as the account calling the placing mutation.
// `bytes` is the same selected image; api.open is your own two-image mutation.
const first = await client.upload(bytes);
if (!first.ok) throw Error(first.why.message);
const second = await client.upload(bytes);
if (!second.ok) throw Error(second.why.message);
const write = await client.mutate(api.open, {
  front: {id: first.asset.id}, back: {id: second.asset.id},
});
if (write.state === "failed") throw Error(write.why.message);
```

For durable App uploads, each `uploadAndPlace` intent owns one placement.
For several columns in one mutation use the two explicit uploads above. Retrying a failed mutation with the same ID is
separate from creating a second home. A fresh placement never transfers uploader
or home authority. E_ASSET_PLACED carries this copy recipe in SDK responses.

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
