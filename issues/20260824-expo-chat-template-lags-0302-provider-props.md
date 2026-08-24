# expo-chat template lags the LLP 0302 provider prop change (url prop rejected)

**Status:** Open
**Systems:** Templates, Expo client, Verification
**Date:** 2026-08-24
**Related:** LLP 0302, `9653d21d2` (declared-dev binding), the
expo-chat-template-typecheck battery gate, battery ticket
`20260824-battery-expo-chat-template-typecheck-*.md`

The template typecheck harness repair (this branch) gets the gate past its
devDependencies-parity assertion, which unmasks the next layer: the template's
`App.tsx:134` passes `url` to the SnapbackExpo provider, and `9653d21d2`
(LLP 0302 declared-dev binding, landed 2026-08-24 10:40) changed the provider
prop surface so `url` is no longer accepted there (TS2322; the props now carry
`binding`/`environment`/…). The template needs the 0302-shape update — most
likely moving `url` into the declared binding — by or with the 0302 execution
program, which owns the intended template teaching shape.
