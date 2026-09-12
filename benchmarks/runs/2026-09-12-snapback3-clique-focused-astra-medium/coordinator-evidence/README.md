# Coordinator snapshot audit

This read-only check compares the retained pre-M7 and first post-migration persona exports. It verifies principal content, exact message IDs, all required field values and nonempty controls. It is separate from the immutable grader artifact, whose principal object-identity comparison produced a false failure.

Run `python3 check-m7-snapshots.py` from this directory or invoke the file from anywhere. Its stdout is retained in [m7-snapshot-audit.json](m7-snapshot-audit.json). It does not start an app, mutate a database, or replace a grader result. Inputs are hashed in the output.
