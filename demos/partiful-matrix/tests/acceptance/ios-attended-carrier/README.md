# Partitime attended iOS carrier

This XCUITest carrier observes the two text-dependent Phase 4 claims in
ordinary Mobile Safari. It must not run beside SafariDriver. Remote Automation
may stay off: XCUITest is the sole automation owner, and the operator types
only the requested values into the already-focused fields.

Authority and status are recorded in
`acceptance/physical-ios-text-carrier-amendment.2026-07-28-v3.json`. Until that
amendment is owner-ratified, only static checks, builds, and explicitly
non-qualifying diagnostics are permitted.

Verify the source and generated-project build without writing an `.xcodeproj`
into the repository:

```sh
node demos/partiful-matrix/tests/acceptance/ios-attended-carrier/check.mjs --build
```

The qualifying runner must:

1. preflight one paired, unlocked physical iPhone and record its UDID, product,
   iOS version/build, Xcode version, and host identity;
2. prove that no SafariDriver session exists;
3. start the isolated unchanged Partitime fixture at a device-reachable URL;
4. generate the project from `project.yml` into scratch storage;
5. run one named XCTest at a time, with parallelism and random ordering off;
6. retain the `.xcresult`, screenshot, Safari accessibility tree, exact
   operator values, test identity, URL, and fixture/package identities;
7. classify interruption, navigation away, missing attachment, or a changed
   value as an invalid/red run rather than a pass.

The four operator-entered values are:

- `Keyboard Picnic`
- `Dolores Park`
- `Keyboard picnic`
- `Reduced motion status`

XCUITest supplies the RSVP Space key through the native test input path. It
does not mutate the DOM or issue a WebDriver command.
