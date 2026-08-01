# Bakeoff hazard: a Convex deployment cannot be namespace-shared

**Status:** OPEN — process finding, LLP 0139 (2026-08-01)

LLP 0102's 2026-07-28 target-access amendment assumes a shared target
can be split by arm namespace. Convex breaks that assumption: `convex
deploy` replaces the deployment's whole function set and reconciles the
whole schema. Running the Clip Locker arm's deploy against the shared
dev deployment printed:

    ✔ Deleted table indexes:
      [-] ub_a_profiles.by_handle   handle, _creationTime

i.e. it dropped an index belonging to the concurrently-running App A
(Faceplate) arm's namespace, and replaced any functions that arm had
pushed.

Consequences for the bakeoff: Convex arms must be **serialized** on the
shared deployment (or given separate deployments), and each arm must
re-deploy its own functions immediately before running. Any Convex arm
that ran concurrently with another arm's deploy should be re-run before
its numbers are trusted.

This is an evidence-integrity note about our method, not a product
defect claim against Convex: deployment-as-unit is a coherent design
(it is how their schema/function atomicity works). It does mean
"namespace-scoped cleanup" is unavailable there, and the amendment's
cleanup-proof requirement must be satisfied differently — by owning the
whole deployment for the duration of the arm.

## Resolution (2026-08-01, backlog lane P)

Record-only process finding; no repo code action. The lesson is folded into
LLP 0102's 2026-07-28 target-access amendment as a dated execution note
(deployment-as-unit means the namespace-scoped-write proof is unsatisfiable
on a shared Convex deployment; Convex arms own a whole deployment or
serialize with immediate pre-run re-deploys, and concurrently-exposed runs
must be re-run before their numbers are trusted). Closed.
