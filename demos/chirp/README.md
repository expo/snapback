# Chirp — universal social timeline

An Expo SDK 57 (Expo Router) Twitter-style demo backed by Snapback live
queries and mutations on iOS, Android, and web: a live timeline, posts, and
likes over one generated backend, consumed through `@expo/snapback-react`.
It is listed as an example on `guide/clients/react.md`.

## Run it

```sh
cd demos/chirp
bun install            # once
npm run generate       # regenerate snapback/generated from source
npm start              # Expo dev client (a Snapback server must be running)
npm test               # headless acceptance (boots its own server)
npm run typecheck
```

## Not claiming

No hosted Snapback backend — the current EAS Hosting deployment contains the
universal client only (`demo.snapback.json` `notClaiming`).
