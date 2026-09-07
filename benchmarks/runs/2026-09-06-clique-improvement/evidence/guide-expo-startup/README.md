# Expo startup guide routing

Exact native-authored commits cf6f8495dba799e5844fa9236cd4ed4f1380894b and 1ed181ddf4fa76f153a125259d0e860d6d493620, based on 8f48dc8ef72ba68197a456b1149c3d652b592d21. Root read both complete reports and diffs. Both turns used the same native Astra xhigh session and actually exited 0 before landing.

The installed README now shows the existing Expo chat init command and routes scaffolding to guide init, authentication to guide auth, and certified backend facts to guide app. Existing grammar gives the same routing. The README uses npx after its local npm installation instruction. No command alias, client behavior, schema or native surface changes.

Caps, references and whitespace checks passed. The first external package prose check failed on its incorrect assumption that grammar contained no fenced examples; that failure is retained. The corrected check passed: all 23 keyword outputs, fenced examples and nine other guide pages match the base; grammar uses 3487 of 3584 bytes. The final follow-up adds only four npx prefixes and passes whitespace review. These are prose/correspondence checks, not parser, runtime, installed-package or benchmark qualification.

The published 0.0.13 guide app command correctly reported certified app facts. A separate read-only guide expo observation refused the unknown keyword; the original builder capture lacked stderr, so the later diagnostic does not reconstruct it. This change improves discoverability of existing commands. It is not yet published and is not injected into the ongoing cold run.
