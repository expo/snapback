
## Shared immutable evidence and snapshots

Place once in an immutable home; designs/approvals/snapshots store **row
references**. Second media placement refuses E_ASSET_PLACED. Downloads use the
home's current read rule; references grant no bytes. Reference deletion keeps
bytes; home deletion/expiry revokes them. Retain the home as long as needed.
`on delete keep` preserves audit references; default `restrict` refuses home
deletion. Exclude `once`. Independent copies require authorized download/upload.

```quarry
use identity password
effect scanEvidence

table evidence:
  owner: principal
  document: file <=10000000 ('application/pdf')
  status: enum('pending', 'clean') default 'pending'
  immutable owner, document
  read <- .owner = viewer or viewer = 'service:scanner' or .status = 'clean'
  insert <- .owner = viewer and .status = 'pending'
  update <- viewer = 'service:scanner'
  online only
table snapshots:
  owner: principal
  source: evidence on delete keep
  immutable owner, source
  read <- .owner = viewer
  insert <- .owner = viewer
  delete <- .owner = viewer
  online only
mutation captureEvidence(document: file <=10000000 ('application/pdf')):
  row = insert evidence {owner: viewer, document}
  emit scanEvidence {evidence: row.id}
  return row
mutation shareSnapshot(source: evidence):
  row = evidence[source] ! else NOT_FOUND
  require row.status = 'clean' else NOT_SCANNED
  return insert snapshots {owner: viewer, source: row.id}
query scanTarget(source: evidence):
  require viewer = 'service:scanner' else NOT_SCANNER
  return evidence[source]
mutation approveScan(source: evidence):
  require viewer = 'service:scanner' else NOT_SCANNER
  row = evidence[source] ! else NOT_FOUND
  update evidence[row.id] {status: 'clean'}
```

Clean evidence is account-readable here. Private sharing needs a reader roster
and aligned consumer audiences. Pending bytes remain uploader/scanner-only.
Copy changing business fields separately for a frozen snapshot.

## Scan before sharing: fail closed

Type sniffing is not malware scanning. A trusted `service:scanner` worker reads
`scanTarget` and downloads the immutable bytes using its bearer. It calls this
adapter with those exact bytes. Configure the scanner URL privately; never use
a payload URL. Its authenticated API returns `{verdict: "clean", sha256}` only
after a completed scan, bound to the received bytes' lowercase digest.

```js
import { Retry, GiveUp } from "snapback4/worker";
export async function scanClean(bytes, scannerUrl, doFetch = fetch) {
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
  let reply;
  try {
    const response = await doFetch(scannerUrl, {method: "POST", body: bytes,
      headers: {"content-type": "application/octet-stream", "x-content-sha256": sha256},
      signal: AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error(`scanner HTTP ${response.status}`);
    reply = await response.json();
  } catch { throw new Retry("scanner unavailable or invalid reply; evidence remains pending"); }
  if (!reply || reply.sha256 !== sha256) throw new Retry("scanner did not attest these bytes");
  if (reply.verdict === "infected") throw new GiveUp("scanner rejected evidence; it remains pending");
  if (reply.verdict !== "clean") throw new Retry("scanner verdict unresolved; evidence remains pending");
  return sha256;
}
```

Only after `await scanClean(bytes, scannerUrl)` succeeds, call `approveScan`
with the seat and check `state === "sent"`; otherwise throw `Retry`. Complete
the effect afterward. Redelivery scans the same immutable bytes and approval
is idempotent. Never approve in `finally`, on timeouts, missing/unknown verdicts,
a filename or MIME check. Quarantine stays private during scanner outages.
`runWorker({onError})`, `dev` and `doctor` expose failed attempts.
