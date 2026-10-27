# Snapback 4 clean-userspace publication stops on the deepmerge audit chain

Status: Open
Date: 2026-10-28
Area: Expo starter toolchain / publication audit
Source: DX16's packed Linux consumer-only verification at 442f463fce

All host consumer proofs, frontend proofs and six starter cases passed. The
clean-userspace leg then stopped at the existing assertion:
`@expo/cli: a fix is available; update the starter toolchain`.
A separate Ubuntu repetition retained the public audit and dependency evidence:
[clean-userspace-audit.json](../snapback4/reports/20261027-dx16/clean-userspace-audit.json).
The native SHA-256 matches the host's installed candidate; this is not substitution
of a registry binary. DX16 did not change the SDK manifests or initializer
files that choose the Expo dependency constraints.

The retained npm audit report identifies GHSA-gcqx-w48m-w2h4 on deepmerge
(affected range >=4.2.0 <=4.3.1, low severity in that report), with
`fixAvailable:false` at the leaf. It marks @expo/cli, @expo/metro-config and
@expo/prebuild-config as fixable meta-vulnerabilities. The diagnostic installed
Expo 57.0.30 and nested @expo/cli 57.0.32 with the existing starter overrides.
The host's earlier audit had no findings; registry/advisory timing therefore
matters. Do not infer a usable patched SDK version from the generic assertion.

Reproduce using the normal packed client/platform/Expo tarballs with
`node snapback4/scripts/qualify-linux.mjs --consumer-only --client <client.tgz> --expo <expo.tgz> --out <new-dir>`.
The isolated diagnostic retained package manifests, resolved versions, native
hashes and the version-2 audit response before cleaning its userspace.

Follow up with the publication/toolchain owner: verify current remediation and
SDK compatibility, then rerun fresh clean userspaces. Keep the audit policy;
DX16 does not add an advisory waiver or change its assertions. No publication
qualification is claimed for the stopped run.
