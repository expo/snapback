# M8 receipt requalification addendum

The original final handoff's M8 run10 summary bound suite SHA256 b327b2f7a2f6a3e55ca124e238a63b06fb394fe30d3e816474e5a041208d7004. The later aggregate rerun overwrote that path with SHA256 9370c41b59c8247b8e37767ee5d72574f1bec7ef69a3be4c724724ffb6e423f8. No exact retained original was found; no guessed reconstruction or raw-receipt edit was made.

Copied the final passing suite byte-for-byte to this directory's uniquely named suite.json and pointed a new status file at it. Verified all frozen source-file hashes and every original handoff file hash unchanged. Added a real recent Alice post through the public mutation to supply the ordinary M8 like-refresh precondition, then ran one full frozen M8 choreography with the unchanged source.

The new run is **non-green**. Dual-offline convergence timed out, and the dependent receipt check could not run successfully. The compact run.log retains the exact failures. The failed raw JSONL was not inspected. This failure does not justify a new green qualification or erase earlier passing observations.

addendum.json supplies exact hashes and the later attempt clock. Original archive, report, handoff, boundaries, and assessment files remain untouched. No source edits, exports, typechecks, or additional reruns were performed for this evidence repair.
