# Snapback 4: Supported pending sync IDs exceed the HTTP request-line limit

Status: Open
Severity: major
Priority: P1
Area: sync transport
Reported: 2026-09-14
Baseline: published `snapback4@0.2.6` at `342c53d306d7484cd64e820ee27a151e02eb4b0b`; still present in inspected delivery `04ed8cab8eeca7decc3a25d46873d5a1fccab11d`
Related: [Grok client attribution audit](../benchmarks/runs/2026-09-13-snapback4-clique-0004/grok-grade-client-attribution.md), [resolved stream resource bounds](closed/20260913-snapback4-sync-stream-is-per-group.md)

## Product mismatch

The device's `sync_state` returns up to 256 pending write IDs. The public
protocol documents that bound, and `/sync` accepts 256 IDs of up to 128
characters each. The local client percent-encodes the complete JSON array
into a single `GET /sync` query, but the HTTP parser limits the complete
request line to 8,192 bytes, before routing reaches `/sync`.

Using the exact published client composition, watermark `1091`, and ordinary
26-character IDs minted by the client:

| Pending IDs | Request-line bytes, excluding CRLF |
| ---: | ---: |
| 232 | 8,171 |
| 233 | 8,206 |
| 256 | 9,011 |

The advertised maximum therefore cannot reach the handler even with normal
client-generated IDs. A wider watermark or maximum-length accepted IDs only
increases the discrepancy. No network reproduction was run for this ticket;
the linked audit retains exact source hashes and the deterministic byte
calculation.

A second source review found no pending-ID pagination or body fallback. An
independent Node 24 calculation reproduced the table and measured 9,008 bytes
even with the minimal watermark `0`. Normal one-at-a-time mutation flushing
may eventually shrink a backlog, so this establishes rejection of a supported
sync request, not necessarily a permanent outbox deadlock.

## Benchmark observation and limits

The Grok Clique app repeatedly sends delivered/read mutations for every foreign
message at four delays, causing eight writes per message per effect execution.
Its received grader evidence records failed sync and stale messaging after
this amplification. That application behavior is a separate defect.

The retained failed URL was truncated to 300 characters, so its actual pending
count and full byte length cannot be recovered. The parser returns a bare 400
before route-level CORS handling, which could explain the browser's reported
CORS/network error; no retained wire status or parser diagnostic proves that
this particular failed request took that path. The supported-state transport
mismatch is established independently of that attribution.

## Completion criteria

- Make every supported pending state transportable within explicit HTTP
  resource bounds, including 256 IDs at the maximum accepted length.
- Verify browser and native parity, cursor continuation, and terminal write
  acknowledgement without dropping or starving IDs across batches.
- Cover the exact boundary where the old GET representation exceeded 8 KiB
  and ensure oversized or invalid input has a deliberate bounded outcome.
- Keep the app's repeated receipt writes separate from the product fix and
  retain the benchmark's original 0.2.6 results unchanged.
