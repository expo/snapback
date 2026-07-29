# Isolation discovery attempt

The first gated refresh run completed semantically, but Firebase Functions
implicitly opened Eventarc and Tasks on default ports `9299` and `9499`.
The emulator hub proved those listeners belonged to the exact arm process, the
run did not collide with another listener, and exact cleanup closed both ports.
They had not been preassigned or preflighted, however, so that run is not the
final isolation proof.

Its unmodified receipts are retained under
`work/receipts-isolation-discovery/`, and its capsule is retained as
`isolation-discovery-run-capsule.v1.json`. The final rerun explicitly assigns,
preflights, records, and cleans Eventarc `61121` and Tasks `62121`.
