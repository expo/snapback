# Propagate the 2026-08-02 decision-sitting rulings into their owning LLPs

**Status:** Open — docs-only, do early (implementers read the owning docs,
not the packet)
**Source of truth:** issues/20260802-author-decision-packet.md (the sitting
record). Status flips + dated notes for 0143/0147/0154 already landed with
the sitting; everything below remains.

Apply each as a dated amendment in house style (dated note in the Revised
header and/or the owning section, citing the packet):

1. **LLP 0115 OQ5 + LLP 0111 + LLP 0122**: npm default channel = 0074
   parallel gate; 0111's hosted-serialized `latest` promotion superseded on
   exactly this point (leave its hosted gates intact for hosted claims);
   0122's option-5 question answered.
2. **LLP 0118 OQ7** (+ a pointer from LLP 0127 item 6): cutline =
   context-reader helpers first; declared reads/writes are evidence, not
   ceilings.
3. **LLP 0151**: Option D adopted as the production paved path (per its
   §Round-2 convergence text); SMS OTP moves tier-1 → tier-2 (amend the
   tier table; note the delivery-vendor-owner precondition for promotion).
4. **LLP 0152 OQ14 + LLP 0153**: the boundary ratified — external CIAM is
   a sibling paved path under 0153's provider class; 0153's step-1
   sequencing note updated accordingly.
5. **LLP 0150 OQ2**: exclusive credential-kind model recorded.
6. **LLP 0140 D-1**: keep the TypeScript checker in the shipped closure;
   migration parked until the wave clears (status stays Review; D-1 no
   longer open).
7. **LLP 0144 OQ1**: B3 (admit code, drop payload), with the note that D2's
   union grammar and the wire carrier key follow from it.
8. **LLP 0149**: Slice-0 ownership = the 0062 served envelope (dated note
   in its §Suggested build sequence).

Run ./ref-check --verbose after the batch. One commit is fine; cite the
packet in the message.

**Exit:** all eight amendments landed; this ticket closed with the commit.
