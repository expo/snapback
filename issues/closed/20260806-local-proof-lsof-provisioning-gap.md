# Canonical Linux proof did not provision lsof

**Status:** Closed — fixed forward 2026-08-06
**Opened:** 2026-08-06
**Systems:** CI, Expo supervision, CLI package tests
**Related:** LLP 0010, LLP 0181, GitHub Actions run `31142327486`, PR #18

## Failure

The real-server CLI package gate reached the Expo dev-loop suite and refused
readiness with `SNAPBACK_EXPO_LISTENER_ENUMERATION_UNAVAILABLE`: the Linux
runner did not contain `lsof`.

## Attribution

Commit `567a8e0fd5` made OS listener enumeration mandatory so the backend,
Metro, and supervisor process trees cannot advertise an unobserved LAN or
wildcard listener. The canonical local-proof workflow continued installing
only its earlier native build dependencies, so the stronger proof requirement
had no coded Linux provisioner.

## Resolution

The existing canonical native-dependency step now installs `lsof` alongside
CMake, Ninja, and libcurl. Listener enumeration remains mandatory and no
readiness or loopback requirement was weakened.
