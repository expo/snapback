# Snapback 2 in-memory asset session carriers are unbounded

**Status:** Closed
**Priority:** P2
**Date:** 2026-09-11
**Systems:** `snapback2/crates/snapback2/src/writer_auth.rs` (`mint_asset_carrier`)
**Source:** Snapback 2 codebase review 2026-09-11
**Related:** LLP 1006 §2b (30-minute in-memory carrier)

## Symptom

`POST /api/auth/asset-session` inserts a 32-byte hex token plus a cloned `ResolvedAuthority` into `State.asset_carriers` with **no cap**. `mint_asset_carrier` does not sweep expired entries. Sweep happens only on:

- `resolve_asset_carrier` (an asset GET with `?s=`), or
- `fence_session` (logout / expiry of a **bearer** epoch).

Persona carriers have `session: None`, so `fence_session`’s retain never removes them. They expire at `now+30min` on the struct but stay in the map until some carrier GET runs `retain`.

An authenticated client (including a guest, and a minted-on-first-use persona in `dev`) can POST `/api/auth/asset-session` in a loop and grow owner RSS until process death. Combined with [dev CORS persona CSRF](./20260911-snapback2-dev-cors-star-allows-persona-csrf.md), a page the developer has open can do this to a running `snapback2 dev`.

## Evidence

```274:304:snapback2/crates/snapback2/src/writer_auth.rs
    pub(super) fn mint_asset_carrier(&mut self, identity: Identity) -> Result<Json, Refusal> {
        let authority = self.resolve_authority(identity)?;
        let now = self.now();
        let expires_at = authority
            .session_expires_at
            .unwrap_or(i64::MAX)
            .min(now.saturating_add(ASSET_CARRIER_LIFETIME_MS));
        let token = random_carrier()?;
        self.asset_carriers.insert(
            token.clone(),
            AssetCarrier { authority, expires_at },
        );
```

## Proposed patch

Sweep on mint. Cap the map (1024 global is plenty; 32 per principal is tighter and better). Evict soonest-expiring, or refuse `E_OWNER_BUSY`.

```rust
    pub(super) fn mint_asset_carrier(&mut self, identity: Identity) -> Result<Json, Refusal> {
        let authority = self.resolve_authority(identity)?;
        let now = self.now();
        self.asset_carriers.retain(|_, carrier| carrier.expires_at > now);
        const MAX_ASSET_CARRIERS: usize = 1_024;
        if self.asset_carriers.len() >= MAX_ASSET_CARRIERS {
            if let Some(oldest) = self
                .asset_carriers
                .iter()
                .min_by_key(|(_, carrier)| carrier.expires_at)
                .map(|(token, _)| token.clone())
            {
                self.asset_carriers.remove(&oldest);
            }
        }
        let expires_at = authority
            .session_expires_at
            .unwrap_or(i64::MAX)
            .min(now.saturating_add(ASSET_CARRIER_LIFETIME_MS));
        let token = random_carrier()?;
        self.asset_carriers.insert(
            token.clone(),
            AssetCarrier { authority, expires_at },
        );
        Ok(json!({ "token": token, "expiresAt": expires_at }))
    }
```

Also call the same `retain` from the owner’s periodic session sweep so persona carriers die without an asset GET.

Per-principal cap (e.g. 32) is a better DoS bound if mint is cheap; global 1024 is the floor.

## Acceptance

- 2,000 mints from one principal leave ≤ cap entries.
- Expired carriers are gone after the next mint or session sweep, without an asset GET.
- Logout still drops that epoch’s bearer carriers.
- A writer unit test covers cap eviction and expired retain on mint.

## Resolution (2026-09-11)

Carriers now live at most ten minutes, bounded further by the session expiry.
Mint and every periodic session sweep purge expired entries, including persona
carriers when no asset GET occurs. A usable carrier is reused for the same
principal and session epoch; the map refuses new entries at 1,024 owner-wide or
32 per principal. Refusal preserves already mounted URLs instead of evicting
unexpired credentials. Logout still removes every carrier for that epoch.

The integrated writer-auth regression passed: 2,000 same-persona mints reuse one
entry; forced near-expiry entries hit the per-principal and owner caps; mint and
sweep independently purge expired persona entries; refresh preserves the epoch
and its carrier while logout revokes it. The integrated raw asset roundtrip
also passed (23.93s), including carrier revocation and privacy headers. LLP 1006
and the assets guide record the limits and remaining transferable-URL/log risk.
