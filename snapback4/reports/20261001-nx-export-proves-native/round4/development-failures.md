# Development failures

- Initial edit/test command used snapback4-relative paths with snapback4 as cwd. Python and log redirection refused before edits or Cargo execution; corrected the cwd.
- The receipt-retention edit initially repeated the wrong-cwd path error; Python refused without changing a file. Corrected using absolute paths.
- Initial plain warm attempt rebuilt because the new destination lock was in the project root and entered the native key. Product regression, fixed by placing the lock under the already-excluded artifacts/native-smoke directory. The initial prime/warm measurements remain separate from the final cohort.
- The canonical suite found an introduced guide-budget failure: the witness card grew past its existing 399-line cap. Compacted the added paragraph without changing the cap or removing the custody/reader semantics, then reran the affected guide target separately. The single full-suite result remains recorded as red.
