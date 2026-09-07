# README command-prefix correction

Base `cf6f8495dba799e5844fa9236cd4ed4f1380894b` → `1ed181ddf4fa76f153a125259d0e860d6d493620` on `s2/clique-guide-startup`; worktree clean.

Exact diff: inserted `npx ` before the four new README commands: `snapback2 init my-app --template chat --client expo`, `snapback2 guide init`, `snapback2 guide auth`, and `snapback2 guide app`. Every other byte, including grammar, is unchanged. Inspected the complete diff; `git diff --check` exited 0. No failures in this follow-up.

This is Root's prose-review correction for locally installed CLI use, not an observed benchmark failure. Prior snippet/keyword evidence remains applicable. No tests, package invocation, build, registry, publication, benchmark access, or push. No broader claims.

Writer released. Parent records the actual CLI terminal after return.
