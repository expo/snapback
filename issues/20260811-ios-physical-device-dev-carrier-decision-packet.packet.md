# Decision packet: iOS physical-device development carrier

**Status:** Packet complete — awaiting author go/no-go
**Ticket:** `issues/20260811-ios-physical-device-dev-carrier-decision-packet.md`
**Systems:** React/Expo, Local server lifecycle, Developer experience, Security, Auth, Packaging
**Governing:** LLP 0168 (gate), LLP 0181 (binding union), LLP 0060 (transport/auth contract)
**Date:** 2026-08-11
**Related:** `issues/20260804-tunnelled-loopback-server-keeps-dev-profile.md` (separate,
still-open, retains its own present-tense owner),
`diaries/0058-relay-room-expo-backend-bakeoff.diary.md`,
`diaries/0059-tandem-expo-messaging-bakeoff.diary.md`,
`diaries/0075-tiny-triumphs.diary.md`, and — found by the wider sweep in §1 —
`diaries/0008-all-aboard.diary.md`, `diaries/0053-chirp-expo-twitter-clone.diary.md`,
`diaries/0056-warble-local-first-microblog.diary.md`,
`demos/partiful-matrix/acceptance/evidence/2026-07-23-android-chrome-current/device-receipt.json`

## What this packet is

It answers one question: **can LLP 0168's successor-RFC gate open for a native
Expo/Metro iOS physical-device carrier?** It authorizes nothing. It creates no
relay, tunnel supervisor, public listener, binding arm, or successor RFC. Every
claim about current behavior below was checked against source in this working
tree, not against prose.

**Recommendation in one line:** adopt topology (c) — *an already-hosted Snapback
backend plus a separately admitted development asset carrier* — and hold the
LLP 0168 successor-RFC gate **closed (not-yet)** for a Snapback-owned
route-composing development edge.

## 1. Evidence ledger

The ticket's acceptance bar requires three categories to be kept apart. They are
kept apart here, per artifact.

| # | Artifact | Claim | Class |
| --- | --- | --- | --- |
| E1 | `diaries/0075-tiny-triumphs.diary.md:73` — "Physical-device carrier: Expo Go link prepared; awaiting user launch" | An Expo Go entry point existed | **Setup.** Nothing ran on a device. |
| E2 | `diaries/0075-tiny-triumphs.diary.md:71-72` — "Public Snapback inspect endpoint: healthy at the Tuft-hosted backend URL"; "Public Metro manifest/web response: healthy at the Tuft-hosted app URL" | Two public HTTPS exposures answered correctly | **Successful launch — of the host side only.** The prover was the development machine, not a phone. |
| E3 | `diaries/0075-tiny-triumphs.diary.md:50-52` — "the physical phone needs both Metro and the local Snapback backend exposed from the development machine. Tuft made that workable with stable HTTPS names" | Two independent public names were required | **Demand**, stated by the author of the demo. |
| E4 | `diaries/0059-tandem-expo-messaging-bakeoff.diary.md:155-162` — "Both ad hoc iOS development-client builds finished successfully on EAS for all six registered devices. This proves the native shells compile and are installable; I did not claim a physical-device interaction receipt in this session" | Two EAS ad hoc dev-client builds finished | **Setup.** The diary itself declines the device claim. Two build IDs are retained; a build ID is a build artifact, not a device run. |
| E5 | `diaries/0059-tandem-expo-messaging-bakeoff.diary.md:178-180` — "Both Metro servers: verified locally and through their Tuft public URLs; the served iOS manifests named the correct app and carried the public bundle origin" | The public manifest carried a rewritten bundle origin | **Successful launch — host side.** This is the strongest *mechanism* evidence in the corpus: it shows manifest rewriting is the load-bearing part. No device fetched it. |
| E6 | `diaries/0059-tandem-expo-messaging-bakeoff.diary.md:127-129` — "local storage URLs use loopback; a physical phone reaching the API through Tuft needs the adapter to rewrite storage origins to the separate public site tunnel" | The Snapback/asset origin needs its own rewrite, to a *second* public name | **Demand**, plus a concrete mechanism finding. |
| E7 | `demos/relay-room-bakeoff/snapback-expo/scripts/dev-server.mjs:42-55` — binds `0.0.0.0`, sets `SNAPBACK_PROFILE: 'dev'`, passes `--allow-insecure-dev-auth`, then prints `EXPO_PUBLIC_SNAPBACK_ORIGIN=http://<lan-ip>:<port> bun run start` | A committed demo launcher makes the backend LAN-reachable for a phone | **Setup — and a retained artifact of the workaround itself.** This is the most serious item in the ledger: see §3.4. |
| E8 | `diaries/0058-relay-room-expo-backend-bakeoff.diary.md:239-242` — "The browser-control runtime failed during its own setup … This is why the receipt is a bundle/runtime-console proof rather than a screenshot or tap-through recording." | Even the *simulated/web* interaction receipt was not captured | **Absence**, self-declared. |
| E9 | `demos/expo-golden-path-fixture/receipts/physical-device-online-checklist.md:1-3` — "**NOT A RECEIPT.** This is an opportunistic live-run checklist. No physical-device result or LLP 0064 capability claim follows from this file." | A physical-device procedure exists for Android USB | **Setup.** The file disclaims itself in its first line. |
| E10 | `llp/0181-zero-configuration-expo.rfc.md:990-993` — "the headless-proven Android USB extension. Its live receipt is pending; iOS USB is a typed non-capability" | Even the *representable* physical carrier (Android USB) has no live receipt | **Absence**, in the governing RFC's own Status. |

A wider corpus sweep then found five items outside the ticket's named sources
that change the picture materially. They are recorded with the same discipline.

| # | Artifact | Claim | Class |
| --- | --- | --- | --- |
| E11 | `diaries/0056-warble-local-first-microblog.diary.md:230` — "**The device found a third thing I could not reproduce.** On a physical iPhone the app showed `Live` in the header, a retained frame, and `Retention: SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE`"; `:691` concedes "everything native here ran through Expo Go against a LAN dev server" | An iPhone ran the app in Expo Go against a LAN dev server and exposed a defect the author could not reproduce elsewhere | **Successful launch — on a real iPhone.** No durable artifact retained; the only committed Warble evidence file is a headless-Chrome origin comparison. |
| E12 | `diaries/0053-chirp-expo-twitter-clone.diary.md:85` — "Physical-device testing then caught a subtler optimistic flicker." | An iPhone caught a client defect | **Successful launch.** The same diary's Verification block records only the iOS 26.4 **simulator**; `demos/chirp` has no evidence directory. |
| E13 | `diaries/0008-all-aboard.diary.md:1570` — "First real run on a physical iPhone (screenshot feedback): the red header drew under the status bar"; `:1975` — "On a rebuilt physical iPhone host, `http://100.88.75.121:5178/` then rendered the All Aboard board; taps and native scrolling worked" | Repeated iPhone runs against a dev server on a **Tailscale** overlay address | **Successful launch.** Screenshots referenced but never committed. `demos/all-aboard/demo.snapback.json:90` and `measurements/update-economy.final.md:59` *assert* the device run in committed files but retain no device identity or device data — a committed claim is still not a receipt. |
| E14 | `demos/partiful-matrix/acceptance/evidence/2026-07-23-android-chrome-current/device-receipt.json` — `deviceSerial 00339362A001843`, Nothing `A069P`, Android 16 build fingerprint, Chrome 150.0.7871.186, `"url": "http://127.0.0.1:44103/partitime/?user=eve"` reached over three `adb reverse` rules, plus nine committed device screenshots | A physical Android phone drove a real Snapback dev backend to completion | **RETAINED LIVE-DEVICE RECEIPT.** The only one in the corpus. Two qualifications: the surface is **mobile Chrome**, not a native RN/Expo binary; and the transport is `adb reverse` port-forwarding to device loopback — i.e. the shape LLP 0181 already ships for Android, with no public listener and no tunnel. |
| E15 | `llp/0143-expo-push-notification-seam.rfc.md:998` / `issues/closed/20260802-push-01-0143-implementation.md:41` — "the paired physical phone loaded the probe through Metro and minted its token entirely inside the app" | A paired phone loaded a probe app through Metro and minted a push token | **Successful launch, borderline.** Retains an EAS build ID, a witness ID, and an Expo ticket ID — all service identities, not device or OS identities — and the probe app lives outside this repository. Not a receipt. |

### 1.1 Finding: exactly one retained live-device receipt exists, and it is not iOS and not native

**No retained live-device receipt exists for any native iOS physical device.**
None exists for a native Android physical device either. The Expo receipt
directory (`demos/expo-golden-path-fixture/receipts/`) contains dated iOS
**simulator** and Android **emulator** receipts (G1–G4, 2026-08-06 through
2026-08-10) with JSONL supervisor streams and screenshots; every physical-device
file in that directory is a checklist that disclaims itself in its first line
(E9). The one retained live-device receipt in the whole corpus is E14 — a
physical Android phone driving a Snapback dev backend in **mobile Chrome** over
`adb reverse`.

Three consequences bear on the recommendation.

1. **The iOS workflow has been completed repeatedly, and only ever by
   workaround.** E11, E12, and E13 are physical iPhones running Snapback apps in
   Expo Go against a LAN or Tailscale-overlay dev server, across three separate
   demos, none of them supported and none of them retained. This corrects the
   narrower reading of the ticket's three named diaries: the demand is not merely
   stated, it has been *acted on and satisfied by improvisation* for months.
2. **The device found defects the simulator did not.** E11 is explicit — a
   retention fact line the author "could not reproduce"; E12 is an optimistic-UI
   flicker; E13 is a status-bar layout defect. These are three distinct
   device-only defect classes, and they are the strongest available answer to
   "why is the simulator not enough." They are also the reason the simulator row
   in §2.3 cannot be softened.
3. **The one receipt that exists points away from public exposure.** E14's
   transport is device loopback over `adb reverse`: no public name, no
   certificate, no listener, no front. The only physical-device evidence anyone
   has retained was produced by the *narrowest* carrier shape available, not by a
   tunnel. That is a data point about which topologies produce evidence.

The cheapest remaining evidence is still the Android USB **native** receipt (E9's
checklist), which costs one cable and one afternoon and would give LLP 0181's
port-forward arm its first live native claim.

## 2. Demand and carrier statement (LLP 0168 A1)

### 2.1 The exact workflow

There are **two** distinct iOS physical-device workflows in the diaries, and
they have different answers. Conflating them is the main hazard in this area.

| | W1 — Expo Go | W2 — development client |
| --- | --- | --- |
| Observed in | Diary 0075 (Tiny Triumphs); Diary 0058 (Relay Room's launcher prints an Expo Go command) | Diary 0059 (Tandem: EAS ad hoc dev-client builds for six registered devices) |
| Client binding | Pure React binding; the demo deliberately avoids the Snapback Expo native carrier so it stays Expo Go compatible (`diaries/0075:54-56`) | Native shells with the real native dependency set |
| Reload behavior required | Metro Fast Refresh / HMR over the same origin that served the manifest; a JS-only reload, no rebuild | Same, plus native rebuild on native-dependency change |
| Who holds the phone | Frequently **someone other than the developer** — the recorded Tiny Triumphs intent is to hand a person a link | Usually the developer, or a registered ad hoc device |
| Snapback binding available today | `supervised-dev` only, and that arm cannot represent a physical device (LLP 0181 §Real devices in the baseline) | `release` arm with `routing: "https"` — representable |

The precise required reload behavior for both: the Metro **manifest**, the
**bundle**, the **HMR WebSocket**, **source maps**, and every **asset URL** must
all resolve on a name the phone can reach, and the manifest's embedded bundle
URL must be rewritten to that name (E5 is the only positive evidence in the
corpus that this rewrite works). The Snapback origin is a **separate** name with
its own rewrite requirement (E6).

### 2.2 Observed frequency

**Six demos improvised an iOS physical-device path, and each improvised
differently.** Three in the ticket's named window, three earlier:

| Date | Demo | Improvised carrier | Class |
| --- | --- | --- | --- |
| 2026-08-11 | Diary 0075, Tiny Triumphs | Two Tuft tunnels | Setup (E2, E3) |
| 2026-08-05 | Diary 0059, Tandem | Two Tuft tunnels + in-app storage-origin rewrite | Setup (E5, E6) |
| 2026-08-05 | Diary 0058, Relay Room | **LAN bind + two explicit fence overrides** | Setup, retained in code (E7) |
| 2026-08-04 | Diary 0056, Warble | Expo Go against a LAN dev server | **Launch** (E11) |
| earlier | Diary 0053, Chirp | Physical-device testing, carrier unrecorded | **Launch** (E12) |
| earlier | Diary 0008, All Aboard | Expo Go against a **Tailscale overlay** dev server | **Launch** (E13) |

Six distinct improvisations across at least four distinct transports (public
tunnel, plaintext LAN, Tailscale overlay, unrecorded). Diary 0063
(`expo-g1-ios-golden-path`) is not a counterexample: it is simulator-only by
design and stays inside the supported baseline.

This is not a theoretical matrix cell and not a stated preference. It is a
workflow that has been **completed on real iPhones at least three times**, every
time outside any supported carrier, and never once with a retained receipt
(§1.1).

One shape in that table deserves separate notice. All Aboard's Tailscale case
(E13) is neither a public tunnel nor a plaintext LAN bind: it is a
peer-authenticated private overlay with no public listener. It is not in the
ticket's four-option menu and this packet does not add it as a fifth
recommendation — but it is the most likely *content* of any future successor RFC
in this area, and §7.3 lists it as a reopen trigger rather than burying it.

### 2.3 Why each alternative does not serve it

| Alternative | Serves W1 (Expo Go)? | Serves W2 (dev client)? | Why not |
| --- | --- | --- | --- |
| **iOS simulator** | Partly | Partly | It is the shipped baseline with real receipts and it serves most of the engineering loop. It does **not** serve two things this corpus documents. First, the recorded Tiny Triumphs motive: handing a link to a person holding their own phone. Second, and more decisively, **three distinct device-only defect classes that the simulator did not surface** — a retention fact line the Warble author "could not reproduce" (E11), an optimistic-UI flicker caught only on device (E12), and a status-bar layout defect (E13). An earlier draft of this packet recorded that no diary showed the simulator failing an engineering iteration; the wider sweep falsified that, and the correction strengthens the demand case rather than weakening it. |
| **Android USB** | No | No | It is a different OS. It cannot serve an iOS-only surface (iOS haptics, Apple HIG large-title stack, iOS-specific export). It also requires physical possession of the device by the development machine's operator, which the recorded demand (hand a person a link) explicitly does not have. Its own live receipt is still pending (E10). |
| **Static HTTPS export** | No | No | It removes Fast Refresh entirely, so the required reload behavior is gone by construction. It also removes only the *Metro* half of the problem: the app still needs a reachable Snapback origin, which is the half that carries data and authority. Tiny Triumphs' passing web export (`diaries/0075:73`) is a demonstration fallback, not a native-app carrier. |
| **Already-hosted release target** | **No** | **Yes** | LLP 0181 already names this as the one representable physical-device path. It serves W2 well. It cannot serve W1: the `release` arm requires `provenance.buildReceipt` and an `integrity` arm that verifies, and an Expo Go client loading a dev bundle from Metro has no build receipt — so there is no representable binding for "development bundle, hosted backend, Expo Go." It also does not serve the *development loop* for either workflow, since HMR against the working tree is gone. |

### 2.4 Reconciling LLP 0168 A1 with a native Metro carrier

A1 verbatim (`llp/0168-browser-carrier-dev-edge.research.md:238-241`):

> **A1. Demand evidence.** A real workflow requires remote **browser** HMR and is
> not acceptably served by the LLP 0030 Vite relay, Android forwarding, a static
> HTTPS export, or a bundler-embedded shared relay. Names the carrier and
> frequency, not a theoretical matrix cell.

**A1 as written does not cover the native carrier, and the demand described in
§2.1–2.2 cannot satisfy it literally.** Three concrete mismatches:

1. **"browser HMR" is the wrong subject.** The observed workflow is native
   Expo/Metro Fast Refresh in Expo Go or a dev client. This is not pedantry:
   0168's *strongest* motivating finding — that an ordinary LAN HTTP origin is
   not a secure context, so Web Locks is absent and the browser store degrades to
   memory — **does not apply to the native carrier at all.** A React Native app
   has no `isSecureContext` gate; Snapback's native arm is the Expo file carrier,
   which Diary 0058 proved retains across relaunch at
   `implementation: "file"` (`diaries/0058:255-268`). A native carrier therefore
   inherits 0168's security burden without inheriting its central benefit.
2. **The alternative list is browser-shaped.** "The LLP 0030 Vite relay" and "a
   bundler-embedded shared relay" are not candidate answers for an iOS phone. The
   correct comparison set is the one in §2.3: simulator, Android USB, static
   export, hosted release target.
3. **The native carrier adds a requirement A1 never names**: the Metro manifest
   rewrite, the HMR WebSocket, source maps, and asset URLs must all be composed on
   the reachable name (E5, E6). 0168 mentions Metro manifests only in its
   *acceptance* conditions (B1, B3), never in its entry conditions.

**Cross-document defect worth an author ruling.** LLP 0181
§Physical-device LAN relay gates E5 — the *physical-device* carrier — on LLP
0168's preconditions. But 0168 A1 is phrased about remote **browser** HMR. As the
two documents currently read, a native iOS Metro carrier can never satisfy A1
literally, so 0181's E5 is gated on a precondition that does not match its own
subject. This is a real inconsistency, not a drafting nit, and it should be fixed
regardless of the go/no-go outcome. See §7.2 for the exact amendment.

## 3. Current behavior, verified against code

Everything in this section was read in this working tree. Prose claims elsewhere
in the corpus are corrected where they overreach.

### 3.1 Profile is derived from the server's own bind

`resolve_profile` (`crates/snapback/src/admin.rs:291`) returns `Dev` when `SNAPBACK_PROFILE` is
unset/empty and the bind is loopback, `Prod` otherwise; any exact
`dev|demo|test|prod` overrides; any other non-empty value fails closed to `Prod`.
`ServerProfile::for_bind_ip` (`crates/snapback/src/admin.rs:158`) feeds it the concrete address
startup will bind. A front is invisible to it. This confirms the tunnel ticket.

### 3.2 What the `dev` profile actually unlocks

`operation_profile_requirement` (`crates/snapback/src/admin.rs:199-244`) marks these `NonProd`:
`app.reset`, `app.ensure.provision`, the four `app.seed.*` operations,
`schema.load`, `functions.load`, `function.run`, `auth.mintSession`, and the
`asset.put|ensureSeedFixture|inspect|list|retry|delete` operator surface.
`auth.rescueCollidingTable` is `DevOrTest`.

### 3.3 Correction: the profile gate is only half the authority tuple

The tunnel ticket says the loopback default "grants the
destructive/provisioning capability" to whoever reaches the public URL. That is
accurate about the **profile** half and quotes the source comment correctly. It is
**not** the composite exposure, because those operations are separately gated by
`OperationAuthorityRequirement` and `evaluate_access` (`crates/snapback/src/admin.rs:3557`):

- **AdminWrite with a configured token:** the token is required, loopback or not.
- **AdminWrite with no configured token:** allowed on loopback — but that branch
  is documented as unreachable from the serve path, because
  `resolve_serve_admin_token` (ENG-23443) always resolves or auto-mints a token
  before serving (`crates/snapback/src/admin.rs:3546-3556`). The token lands in an owner-only
  `<ready-file>.admin-token` sibling, which a tunnel does not expose.
- **AdminRead:** `else if loopback || token_ok` — **allowed with no credential at
  all on a loopback bind.**

So the accurate present-tense exposure of a tunnelled loopback dev server is:

1. **Unauthenticated AdminRead** to anyone holding the public URL: admin inspect,
   the data-explorer read surface, declared clients, and the rest of the
   `RoutePolicy::AdminRead` registrations.
2. **Client-asserted application identity**: in `PolicyAuthMode::Dev` the caller
   supplies its own `auth` in the request body — `resolved_wire_ephemeral_auth`
   (`crates/snapback/src/server.rs:29510-29522`) returns exactly what the client sent, and
   `WirePublishRequest::resolve` (`crates/snapback/src/server.rs:29536`) takes `session_id`,
   `user_id`, and `custom_key` from the wire. Anyone with the URL acts as any
   user.
3. **Not** unauthenticated reset/provisioning on a served instance.

This refinement belongs to the tunnel ticket's owner. **This packet does not close
or duplicate that ticket**; it hands over one correction (the composite is 1+2,
not "reset for anyone") and one addition: `ctx.loopback` is *also* the gate for
value-carrying configuration writes (`crates/snapback/src/server.rs:19404`, `19446`), whose
source comment states "An SSH tunnel (loopback at the server) is the blessed
remote path." That comment is a second, independent site where a loopback peer is
treated as authority, and it is a design statement, not an accident.

### 3.4 The Relay Room launcher defeats both fences deliberately

`demos/relay-room-bakeoff/snapback-expo/scripts/dev-server.mjs:42-55` binds
`0.0.0.0`, sets `SNAPBACK_PROFILE: 'dev'` (so the non-loopback bind does not fall
back to `Prod`), and passes `--allow-insecure-dev-auth` — which `crates/snapback/src/cli.rs:801`
documents as "Permit client-asserted dev auth on a plaintext non-loopback bind,"
i.e. LLP 0060 D1's "explicit non-production dev override."

This is **worse than the Tuft case**, and the difference matters for the
recommendation. Under Tuft the server stayed loopback-bound and the public leg was
TLS-terminated by the tunnel, so the bearer path was confidential end to end even
though the exposure was undeclared. Under this launcher the server is on the LAN
in plaintext, with client-asserted identity, by explicit override — every peer on
the network gets item 1 and item 2 from §3.3 with no TLS at all.

That a committed demo helper does this is the single strongest argument that the
absent carrier is generating real, retained, in-repo risk rather than only
inconvenience.

### 3.5 The iOS refusal is real code, not a plan

`refuseUnsupportedIosUsbForwarding` and `inspectIosForwardingTools`
(`packages/snapback-cli/expo-dev.mjs:518-560`) probe `xcrun devicectl` and
`iproxy`, record `requiredDirection: 'ios-device-loopback-to-host-loopback'` and
`iproxy.direction: 'host-loopback-to-ios-service'`, and throw
`SNAPBACK_EXPO_IOS_USB_REVERSE_FORWARD_UNAVAILABLE` before any child starts.
`createExpoRoutingPlan` maps `platform === 'ios'` to `same-host-loopback` with
`device.class: 'simulator'`. LLP 0181's claim is implemented.

## 4. Auth-boundary answer (LLP 0168 A2)

A2 requires: *a reviewable design in which the server no longer infers safe
client-asserted identity from a loopback peer that may be a front — or an argued
trust channel that is unforgeable under an explicit local-process threat model.
Prose is sufficient; it must be falsifiable.*

### 4.1 The rule

> **Client-asserted development identity is granted by an explicit capability
> minted by the process that bound the listener, never by the transport peer's
> address.**

Concretely, three changes that stand or fall together:

1. **`PolicyAuthMode::Dev` stops honoring a body-supplied `auth`** unless the
   request also presents a **dev-identity capability**. Absent the capability, a
   dev-mode app-data request refuses exactly as a sessions-mode request with no
   bearer refuses. The loopback bit is not consulted.
2. **The capability is delivered only over the LLP 0181 `local-supervised-ipc`
   channel** — the same transient, supervisor-owned, `no-store` loopback exchange
   that already delivers the `AppBinding` and the ordinary session bearer
   (LLP 0181 §Delivery E1, OQ 1–2). It is bound to one supervisor generation and
   expires with it. It is never a network hop, so there is no remote party to
   authenticate against — the property LLP 0181 already relies on for binding
   integrity.
3. **The two remaining loopback-as-authority sites are converted to the same
   check**: `evaluate_access`'s tokenless `AdminRead` branch (`crates/snapback/src/admin.rs:3581`)
   and the `ctx.loopback` configuration-write gate (`crates/snapback/src/server.rs:19404`,
   `19446`).

### 4.2 The explicit local-process threat model

The design states its boundary rather than leaving it implicit:

- **Excluded:** every remote caller, every LAN peer, and every caller arriving
  through any front — tunnel, reverse proxy, LAN edge, or SSH forward. None can
  obtain the capability, because the mint channel is not reachable through a
  forwarded TCP port; it is a supervisor-owned exchange whose material is
  delivered to a child the supervisor started.
- **Inside the trust base, by construction:** any process running as the **same
  OS user** on the same host. Such a process can read the ready file, the
  `<ready-file>.admin-token` sibling, and any capability the supervisor persists.
  This is consistent with the already-recorded position that "same-user
  filesystem access *is* local admin (LLP 0036 D3)"
  (`crates/snapback/src/admin.rs:3457-3459`). **The design does not claim to defend against a
  same-user local process, and any successor that claims otherwise is
  overclaiming.**

This is the "unforgeable front/server relationship" half of A2's disjunction,
made explicit rather than argued from convenience. It resolves 0168's round-3
concern #2 (a loopback-minted credential proves possession, not policy) by
removing the mint-by-reachability property entirely: the capability is not
obtainable by reaching loopback.

### 4.3 Reconciliation with the tunnel ticket's open directions

`issues/20260804-tunnelled-loopback-server-keeps-dev-profile.md` keeps two open
directions. This answer relates to both without taking either over:

- **Direction 2 (explicit exposure declaration):** this design **does not need
  it** and does not depend on it. It never asks the server to detect a front,
  which is the unanswerable question direction 2 leaves open ("what does the
  server do when the declaration is absent but a front exists — which it cannot
  detect"). If direction 2 lands anyway, the capability check remains the
  authority and the declaration becomes telemetry and diagnostics.
- **Direction 3 (narrow the loopback default's authority):** this design **is**
  direction 3, extended from the destructive half to the identity half. The
  ticket already observes that direction 3 "is the only one that does not depend
  on operator diligence, and is correspondingly the largest change." That
  assessment is unchanged and is the main cost of this answer.
- **Direction 1 (documentation)** landed on 2026-08-10 in
  `guide/auth/targets.md` and is unaffected.

The tunnel ticket keeps its own present-tense owner and its own scope: today's
shipped server. This packet only fixes what a future iOS carrier's successor RFC
would have to satisfy.

### 4.4 What would prove this answer wrong

| ID | Observation that falsifies it |
| --- | --- |
| F-A2-1 | With the rule implemented, a request arriving through any front that carries a body-supplied `auth` and no capability is **served** rather than refused. The rule is then not in force where it matters. |
| F-A2-2 | The capability can be obtained by any process that can merely open a TCP connection to the server's loopback port. Possession would then collapse back into reachability, and the design would be 0168 concern #2 wearing a new name. |
| F-A2-3 | A capability minted by supervisor generation *N* is still accepted after restart as generation *N+1*. The grant is then not generation-bound and a stale front retains authority across the restart the tunnel ticket cares about. |
| F-A2-4 | **Most likely falsifier.** Removing the loopback branches breaks workflows that have no capability carrier — `curl` against a served dev instance, the LLP 0017 admin console, headless acceptance harnesses, `snapback doctor`, every guide example that talks to a local server — in a way that forces reintroducing a loopback exemption. A design that must keep a loopback exemption to remain usable has not answered A2; it has renamed it. An author deciding go/no-go should treat the size of this blast radius as the real price of the A2 answer. |
| F-A2-5 | A same-user local process is demonstrated to be excluded by the design as specified. That would falsify §4.2's stated boundary in the *safe* direction, but it would mean the threat model is understated and the design under-specified. |

## 5. Hostname and certificate choice (LLP 0168 A3)

A3 requires one named strategy with its per-device trust cost stated **for each
claimed carrier**. Six carriers are evaluated; only one is claimed.

| Carrier | Per-device trust / bootstrap cost | Stability across host changes | Metro manifest | HMR WebSocket | Source maps | Snapback origin |
| --- | --- | --- | --- | --- | --- | --- |
| **C1. iOS simulator** (shipped baseline) | None. `127.0.0.1`, no TLS, no prompt. | Total — the name never changes. | Same-host; no rewrite needed. | Same-host `ws://`. | Same-host. | Same-host loopback; `supervised-dev` binding, `routing: "loopback"`. |
| **C2. Tunnel-provided public name + provider certificate** (what Tuft supplied) | **Zero on the device** — a publicly trusted certificate, no profile, no toggle, no Local Network prompt. This is why it keeps being chosen. | Stable for the tunnel's lifetime or a reserved name; the developer's LAN address is irrelevant. | Requires the packager-proxy rewrite so the manifest's bundle URL names the public origin. E5 is the only positive evidence this works. | Works; tunnels pass upgrades. Untested here through a phone. | Served from the public packager origin; **any capability carried in a URL would leak into them** (0168 B1). | A **second, independent** public name (E3, E6). That second name is precisely the exposure the tunnel ticket owns; the app must also rewrite asset/storage origins to it. |
| **C3. Stable local name + operator private CA** | **High and recurring.** Apple requires a manually installed profile *plus* a separate Certificate Trust Settings toggle (support.apple.com/en-us/102390); repeated per device and after a wipe. Disqualifying for "hand a person a link." | Stable name, but the certificate must cover whatever address the name resolves to as the host moves networks. | Works only if the name is reachable, which on a foreign network it is not. | Same. | Same. | Same name can compose both origins only if something composes routes — i.e. this is C5 in disguise. |
| **C4. Public DNS name + ACME DNS-01, resolving to a private address** | **Zero device trust cost** (publicly trusted CA) — the strongest property of this option, and the one 0168 correctly added. | Name is stable; the A/AAAA record must track the host's private address, and publishing it discloses that address publicly unless split-horizon DNS is run. | Reachable only when the phone is on the same private network as the record's target. Fails on cellular and on a guest network — i.e. fails the recorded "hand a person a link" motive. | Same constraint. | Same constraint. | Requires an owned domain, ACME automation, and renewal reachability; it composes nothing by itself. |
| **C5. Device-side bridge** (device loopback → host loopback over USB) | Requires a **development client** with a native bridge module — so it cannot serve W1/Expo Go at all — plus USB pairing and Developer Mode. | Total; nothing is named or resolved. No certificate is needed, because everything is `127.0.0.1` from the app's view. | Trivially correct: the manifest, bundle, HMR socket, source maps, and Snapback origin are all device-local `127.0.0.1`, exactly as on the simulator. | Same. | Same. | Same. **This is the only option that makes A3 disappear entirely** — which is why LLP 0181 names it as the thing that must be built. Its cost is not certificates; it is that Apple ships no such forward (§3.5). |
| **C6. Hosted release target** (`source: "release"`, `routing: "https"`) | **Zero** — the hosting provider's publicly trusted certificate. | Stable public DNS; survives every host change, network change, and reboot. | Not applicable to the Snapback origin; the Metro half is a separate question (see §6). | Not applicable. | Not applicable. | A single stable HTTPS origin already representable in the LLP 0181 binding union today. |

### 5.1 The named strategy

**Claimed: C6 for the Snapback origin — a hosted public DNS name with a publicly
trusted certificate obtained by the hosting provider.** Per-device trust cost:
zero. No profile, no trust toggle, no Local Network prompt, no split-horizon DNS,
no owned domain, no ACME operations.

**No hostname/certificate strategy is claimed for a development-time Snapback
origin on a physical device**, because the recommendation (§6) does not create
one. C2 is what the demos used and is explicitly *not* claimed: it is the
undeclared-front case that the tunnel ticket owns.

### 5.2 What would prove the A3 answer wrong

| ID | Observation that falsifies it |
| --- | --- |
| F-A3-1 | A physical iPhone requires any per-device certificate profile, trust toggle, or Local Network prompt to reach a hosted Snapback target over its public HTTPS name. The zero-trust-cost claim would be false. |
| F-A3-2 | The hosted target's public name changes across ordinary deploys such that the app's `AppBinding.target.origin` no longer admits, requiring a rebuild. The stability claim would be false. |
| F-A3-3 | C3 or C4 can be brought up on an unmanaged iPhone belonging to someone other than the developer, on a foreign network, without a trust step. The rejection of the private-CA and private-DNS options as disqualifyingly expensive would be false. |
| F-A3-4 | iOS App Transport Security or the iOS 14+ Local Network prompt behaves differently from the assumption embedded in C3/C4 above. **[inferred]** — the ATS and Local Network claims in this table are read from Apple's documented behavior, not measured in this repository. If a carrier proof contradicts them, the row is wrong, not the recommendation. |

## 6. Topology recommendation

**Chosen: (c) an already-hosted Snapback backend plus a separately admitted
development asset carrier.** One topology, one security model.

### 6.1 The idea in one paragraph

Every improvisation in §2.2 treats "expose Metro" and "expose the Snapback backend" as
one problem with one answer, and both diaries that used Tuft ended up with **two
independent public names anyway** (E3, E6). That accident is the insight: the two
exposures are not the same risk and should not share a security model.

- The **Snapback origin** carries data, provisioning, and — in dev policy mode —
  client-asserted identity (§3.3). It must never be a development front. It
  should be an already-admitted hosted HTTPS target with an ordinary session
  posture: `source: "release"`, `routing: "https"`, LLP 0181's one representable
  physical-device path, requiring **no new listener, no new binding arm, no
  relay, and no LLP 0168 gate at all**, because a client pointing at an
  already-admitted target creates nothing.
- The **Metro origin** carries bundles, manifests, source maps, and the HMR
  socket. Its worst case is source disclosure to whoever holds the URL, plus
  bundle injection into the developer's own client. That is a materially smaller
  and better-scoped risk than the Snapback origin's, and it can be governed as a
  *development asset carrier* on its own terms — or left as an explicitly labeled
  unsupported workaround indefinitely, which is the current state.

### 6.2 Why the other three lose

- **(a) Device-side bridge.** Technically the most elegant answer — C5 makes the
  entire A3 table disappear and needs no certificate, no name, and no public
  listener, and E14 shows that the analogous Android shape is the only carrier in
  this repository that has ever produced a retained device receipt. It still
  loses, on two counts. Every USB-shaped answer requires the phone to be plugged
  into the development machine, and half the recorded demand (E3, Tiny Triumphs'
  whole motive) is delivering a link to a person holding their own phone
  elsewhere. And it requires a development client with a native module, so it
  cannot serve W1/Expo Go at all. Apple also ships no supported reverse forward to
  build it on (§3.5) — that is the *cost* objection, not the shape objection, and
  §7.3 treats a change there as a reopen trigger.
- **(b) Route-composing secure edge.** The only option that fully serves "HMR on
  a remote iPhone" — and the option LLP 0168 examined across three dual-family
  review rounds, finding a new dev-auth bypass each round. It requires the §4
  auth-boundary change (whose blast radius is F-A2-4), plus B1–B5, plus a fenced
  spike run under `SNAPBACK_PROFILE=prod`, before an RFC could even be accepted.
  The demand case for it is now genuinely strong (§2.2), so the objection is not
  "nobody wants this." The objection is that its own A3 has no acceptable answer
  (§5, §7.1) and its auth cost is unmeasured. **Not-yet**, not never — and of the
  three rejected options it is the one most likely to come back.
- **(d) Documented no-go.** Rejected because it is not true. The demand is real
  and repeated (§2.2), a supported path for W2 already exists in the binding
  union, and one committed demo helper is already defeating two security fences to
  work around the gap (§3.4). "No-go" would leave that in place with nothing to
  point developers at.

### 6.3 What (c) costs — stated honestly

(c) is not free, and the packet must not pretend it is.

1. **(c) fully serves W2 today and does not serve W1 at all.** The `release`
   binding arm requires `provenance.buildReceipt` plus a verifying `integrity`
   arm; an Expo Go client loading a development bundle from Metro has no build
   receipt. There is **no representable binding for "development bundle, hosted
   Snapback backend"** in LLP 0181's union. Adopting (c) for the Tiny Triumphs
   workflow therefore requires exactly one narrow amendment: a representable
   binding for a development-time client against an **already-admitted** hosted
   HTTPS target.
2. **That amendment is not an edge and is not LLP 0168's subject.** LLP 0168
   governs a Snapback-owned *front edge* — a new public listener composing routes.
   A client that points at a target someone already admitted introduces no
   listener, no route composition, and no new relay-admission policy authority. It
   is a binding-union question (LLP 0181) plus a hosted-target question (LLP 0060),
   both of which have present-tense owners. **The author should not read this as
   the 0168 gate opening by another door**; if a reviewer disagrees, that
   disagreement is itself the ruling to obtain (§8).
3. **The hosted half of LLP 0060 is not finished.** The document's own header
   distinguishes "ENG-24607's implemented local refusal … from the still-unbuilt
   hosted edge facts," and D2 records that the local target "reports no
   effective-source capability." "Just host it" is cheaper than an edge; it is not
   free.
4. **It changes the demo posture rather than the product.** Under (c) a demo that
   wants a phone either (i) targets a hosted backend and accepts a build cycle, or
   (ii) uses the simulator, or (iii) labels its tunnel delivery an unsupported
   workaround. It does not get supported Expo Go plus HMR plus a local backend on
   a physical iPhone. That is the honest state of the world today and the packet
   should not soften it.

## 7. Go/no-go

### 7.1 The recommendation, as a decision

**Outcome: not-yet.** iOS physical-device *local* development stays an explicit
**nonclaim**, and the LLP 0168 successor-RFC gate stays **closed**.

The reason matters, because it is not the reason one would guess:

- **A1 is satisfied in substance and unsatisfiable in wording.** §2.2 supplies a
  named carrier, a named frequency, six improvisations, three completed
  device runs, and three device-only defect classes. That is a stronger demand
  record than A1 asks for. But A1 as written asks about remote *browser* HMR
  (§2.4), which this carrier is not, so it cannot be satisfied literally. **The
  gate is not held closed by lack of demand.**
- **A2 has a reviewable, falsifiable answer with an unmeasured price.** §4 is a
  design that never infers identity from a loopback peer. Its most likely
  falsifier (F-A2-4) is also its cost estimate, and nobody has measured it.
- **A3 is where the gate actually fails.** §5 evaluates six carriers. Every
  hostname/certificate strategy with a zero per-device trust cost either is not a
  development carrier (C6, the hosted target) or does not reach a phone off the
  developer's own network (C4). Every strategy that reaches an arbitrary phone
  charges a per-device trust cost that disqualifies the recorded motive (C3), or
  is an undeclared public front (C2).

Stated as one sentence the author can act on: **LLP 0168's three preconditions
cannot all be satisfied for the same carrier.** A1's substance is met for a
development carrier; A3 has no acceptable answer for a development carrier; A3
has a zero-cost answer only for the hosted carrier, which needs no gate. That is
why the recommendation is topology (c) and not "open the RFC."

What developers are pointed at instead, in order: **iOS simulator** for the
engineering loop; **Android USB** where the OS is not the point; **an admitted
hosted target with a `release` binding** for a real phone.

### 7.2 The LLP 0168 amendment that is due regardless

Independent of the go/no-go, §2.4's cross-document defect should be fixed. The
minimal, non-authorizing edit to `llp/0168-browser-carrier-dev-edge.research.md`:

- **A1** currently says "requires remote **browser** HMR." It should say what it
  means — that A1 is scoped to the browser carrier this Research studied — and
  state explicitly that a **native Metro/Expo physical-device carrier is a
  different carrier whose demand precondition is not stated here.** Whichever
  document eventually owns that carrier must state its own A1, with the native
  alternative set (simulator, Android USB, static export, hosted release target)
  rather than the browser set (Vite relay, bundler-embedded shared relay).
- The **Deliberately open** list ("whether remote iOS/second-machine **browser**
  HMR is common enough to justify an edge") should carry the same scoping.
- LLP 0181 §Physical-device LAN relay should then cite the corrected scope rather
  than gating E5 on a browser-shaped precondition its own subject cannot meet.

Neither edit opens the gate. Both remove a mismatch that currently makes the gate
unmeetable by construction rather than unmet on the merits — which is exactly the
"permanent no wearing a checklist" failure 0168 itself diagnosed and split the
gate to avoid.

### 7.3 What new evidence would reopen the decision

Reopening requires **new observation**, not new argument. Because the gate now
fails on A3 rather than on demand (§7.1), more demand evidence alone will not
reopen it. These would:

1. **A hostname/certificate strategy that reaches an arbitrary phone at zero
   per-device trust cost, for a development-time origin.** This is the missing
   A3 answer and the direct blocker. Any candidate must survive F-A3-1 through
   F-A3-4.
2. **A retained native live-device receipt.** Running the Android USB checklist
   (E9) to a dated artifact would give LLP 0181's port-forward arm its first live
   native claim, and its findings — manifest handling, HMR stability, reclamation
   — apply directly to any iOS carrier. E14 shows the shape works; nobody has
   retained it for a native app.
3. **A change in the tooling premise.** Apple shipping a supported
   device-loopback-to-host forward (a `devicectl` reverse forward or equivalent)
   collapses option (a) from expensive to cheap, makes C5 the obvious answer, and
   removes the A3 problem entirely. `packages/snapback-cli/expo-dev.mjs`'s
   `inspectIosForwardingTools` already probes for exactly this and would detect
   it automatically.
4. **A serious evaluation of the peer-authenticated overlay shape.** E13 records
   an iPhone reaching a dev server over a Tailscale address with no public
   listener. That posture is not in the ticket's four-option menu and this packet
   does not recommend it, but it is the one shape in the corpus that has actually
   worked for iOS and does not require a public front. Someone should determine
   whether it is a carrier or merely a different undeclared front — the answer is
   not obvious, and it is the most likely content of a future successor RFC.
5. **An F-A2-4 measurement.** If the blast radius of removing the
   loopback-as-authority branches turns out to be small, the auth cost objection
   to (b) weakens considerably.
6. **Recurrence with escalation.** Six improvisations already exist. If the next
   several Expo demos also improvise — and especially if any repeats §3.4's
   fence-defeating shape — the cost of *not* having a carrier is rising faster
   than this packet assumed.

## 8. Demo and documentation posture

**Stated plainly: Tiny Triumphs and every other demo must describe Tuft or
tunnel-based phone delivery as an UNSUPPORTED WORKAROUND until an accepted
carrier and a retained live-device receipt both exist.** A stable HTTPS name, a
working QR code, and a healthy public endpoint are convenience, not
authorization — LLP 0181 says a QR code is "discovery/bootstrap UX, not transport
security," and the two exposures in §3.3 persist behind any of them.

The same label applies to every other improvised transport in §2.2, not only to
Tuft: a plaintext LAN bind (E7), an Expo Go client against a LAN dev server
(E11), and a Tailscale-overlay dev server (E13) are all unsupported today. Naming
only tunnels would leave the two *worse* postures unlabelled.

Where that wording needs to go (**this packet does not edit these files** — Tiny
Triumphs is landing in a separate lane):

| File | What it needs |
| --- | --- |
| `demos/tiny-triumphs/README.md` | The run section (lines 7–19) currently says only that the app "is designed for the local Snapback target and an Expo client." It needs one explicit sentence: physical-device delivery through Tuft or any tunnel is an unsupported workaround, not a Snapback carrier; the supported paths are the iOS simulator, Android USB, or an admitted hosted target. Owner: the Tiny Triumphs landing lane. |
| `diaries/0075-tiny-triumphs.diary.md` | The verification line "Physical-device carrier: Expo Go link prepared; awaiting user launch" is already correctly hedged. Adding "(unsupported workaround; no live-device receipt)" would keep it unambiguous for later readers. |
| `guide/clients/react-expo.md` §"Choose simulator, emulator, or USB routing" | The carrier table's iOS USB row already refuses correctly. It has **no row for a tunnel**, which is the path developers actually reach for. A row stating that a tunnelled Metro plus a tunnelled backend is not a carrier — with a pointer to `guide/auth/targets.md`'s existing tunnel paragraph — would close the gap at the point of need. |
| `guide/auth/targets.md` | Already carries the 2026-08-10 direction-1 wording about tunnelled loopback servers. No change needed; it is the anchor the other pages should cite. |
| `demos/relay-room-bakeoff/snapback-expo/scripts/dev-server.mjs` | §3.4's launcher deserves its own follow-up: either a header comment recording that it deliberately defeats two fences and must not be copied, or removal. Filing that is out of this packet's scope, but it should not be left unremarked. |

## 9. What needs an author ruling, not an analyst's judgment

1. **Is Expo Go plus a hosted Snapback backend a workflow Snapback wants to
   represent?** §6.3 shows there is no representable binding for "development
   bundle, hosted backend." Adding one is a small amendment with a real
   authority question behind it, and it — not the edge — is the actual decision
   the Tiny Triumphs demand points at.
2. **Does a client pointing at an already-admitted hosted target fall inside
   LLP 0168's gate?** §6.3 argues no (no listener, no route composition). If the
   author reads 0168 more broadly, the recommendation needs re-scoping before
   anyone acts on it.
3. **Is the LLP 0168 A1 scoping edit (§7.2) accepted?** It is an accuracy fix
   that authorizes nothing, but it edits a governing document's gate wording, and
   the author owns that.
4. **Is the F-A2-4 blast radius worth measuring now?** It is the single fact that
   most changes the cost of ever choosing topology (b), and it is measurable
   today without building anything.
5. **Should the Android USB live receipt be scheduled?** It is the cheapest
   available evidence in this entire area (§1.1), it belongs to LLP 0181's E-track
   rather than to this ticket, and this packet has no authority to schedule it.
6. **Is a peer-authenticated private overlay (E13's Tailscale shape) a carrier
   or an undeclared front?** It is the one transport in the corpus that has
   worked for iOS without a public listener, it is outside the ticket's
   four-option menu, and answering it is a posture judgment rather than an
   analytic one. This packet deliberately does not answer it, so that the
   recommendation stays one topology rather than a menu.

## 10. What could not be determined from the repository

- **What actually breaks on a real iPhone, in enough detail to design against.**
  This is the single most important gap. Three iPhone runs succeeded (E11, E12,
  E13) and each surfaced a defect, but none retained an artifact, none recorded
  its carrier's configuration, and none measured HMR stability, manifest
  rewriting through two independent tunnels, session behavior across reconnect,
  or asset-origin rewriting. The demand is now well established; the *engineering
  facts a carrier design would need* are still absent, and the corpus cannot
  supply them because nobody wrote them down at the time.
- Whether the Tiny Triumphs Expo Go link would have worked. E1 is setup evidence
  and nothing more.
- Whether Snapback's Expo file-carrier retained-query store is keyed by backend
  origin. If it is, origin stability matters for the native carrier the way it
  matters for the browser store, and the A3 stability rows understate their own
  importance. Not determined here.
- Whether any hosted Snapback target is currently operable end to end for a demo
  of this shape, as opposed to representable in the binding union. LLP 0060's
  hosted facts are documented as still-unbuilt; how far the Fly and Cloudflare
  adapters close that is outside what this packet verified.
- The precise `RoutePolicy::AdminRead` route inventory. §3.3 establishes that
  tokenless loopback reads are allowed; enumerating exactly which operator
  metadata that discloses through a front is work for the tunnel ticket's owner.
