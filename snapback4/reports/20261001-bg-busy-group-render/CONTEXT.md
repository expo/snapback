# BG round 0 context

Scope: server commit and /changes; partition delivery; wasm apply; local observation,
facade and React publication. Baseline branch: sb4-intent/bg-busy-group-render.

Governing documents (Snapback 4 fence; foundation links cover Snapback 1):

- LLP 3000 §7: detached read transactions, live notifications and one Rust interpreter.
- LLP 3000.015 §3 (current): live row-keyed counts, authorized basis, meter reservations,
  writer recounts and transaction-local batch certification.
- LLP 3000.019 §3.6 (current): sync owns an independent, coherent read transaction.
- LLP 3000.023 §10 (current): RL answer retention, PQ eight starts/active attempts,
  PR scope and revision fences, PRL ready callbacks, LL park until notified cut applies.
- LLP 3000.002 device representation: unchanged byte ratchet and physical bounds.
- LLP 3000.013 §6: coherent IndexedDB authority under the session lock, strict
  session writes, immediate epoch fences and a capture-only localStorage mirror.

Read the current reads guide and calibration schema/React source. The application
holds a 20-row history and separate 20-row decoration query; acquisition is last
500 messages, while the server has 10,000. Decorations inspect 50 members;
read and delivery receipts mutate membership rows. Unknown dependencies remain
conservative; no result cache, authorization shortcut, renewed retention deadline,
or changed runtime ceiling is permitted by this optimization.

Measured costs: single-row live-basis source scans and three IndexedDB reads per
app authority check. Selected changes reuse caller-reserved decoder pages for
streams and read both session fences in one fresh locked transaction. Read the
current client guide and LLP 3000.013 §6 before the latter change. No cross-check
authority cache, notification-policy change, or protocol addition. Both governing
LLPs are updated with the code. Hand-off: none; this commission explicitly
authorizes qualification scripts, tests, the report and implementation.
