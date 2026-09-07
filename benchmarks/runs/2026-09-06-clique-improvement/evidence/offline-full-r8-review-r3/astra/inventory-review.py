"""Inventory the preserved review inputs without executing product code."""
import hashlib
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
PACKET = ROOT.parent / "packet"


def digest(path):
    data = path.read_bytes()
    return {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}


def closure(prefix, entries):
    # Conservative static closure: includes type-only imports; no claim to be
    # a runtime loader trace. Explicit fixture reads are separate roots.
    visited, external, unresolved = set(), set(), []
    pending = [ROOT / p for p in entries]
    pattern = re.compile(r'''^\s*(?:import|export)\s+(type\s+)?(?:\{[^}]*\}|\*|[A-Za-z_$][\w$]*(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+))?)\s+(?:as\s+\w+\s+)?from\s*(["'])([^"']+)\2''', re.MULTILINE)
    dynamic = re.compile(r'''\bimport\s*\(\s*(["'])([^"']+)\1''')
    side_effect = re.compile(r'''^\s*import\s*(["'])([^"']+)\1''', re.MULTILINE)
    while pending:
        path = pending.pop().resolve()
        if path in visited:
            continue
        visited.add(path)
        if path.suffix not in (".ts", ".js", ".mjs"):
            continue
        source = path.read_text()
        references = [(specifier, bool(type_only), False) for type_only, _, specifier in pattern.findall(source)]
        references.extend((specifier, False, True) for _, specifier in dynamic.findall(source))
        references.extend((specifier, False, False) for _, specifier in side_effect.findall(source))
        for specifier, type_only, lazy in references:
            if not specifier.startswith("."):
                external.add((specifier, type_only, lazy))
                continue
            target = path.parent / specifier
            choices = [target, target.with_suffix(".ts")]
            if not target.suffix:
                choices.extend([pathlib.Path(str(target) + ".ts"), target / "index.ts"])
            found = next((p for p in choices if p.is_file()), None)
            if found:
                pending.append(found)
            else:
                unresolved.append({"source": str(path.relative_to(ROOT)), "specifier": specifier, "type_only": type_only, "dynamic": lazy})
    return {
        "method": "Conservative static import closure including type-only imports, plus explicit fixture roots; not an actual-load trace",
        "prefix": prefix,
        "entries": entries,
        "files": {str(p.relative_to(ROOT)): digest(p) for p in sorted(visited)},
        "external_specifiers": [{"specifier": s, "type_only": t, "dynamic": d} for s, t, d in sorted(external)],
        "unresolved": unresolved,
    }


record = {"source_copy_checks": {}, "identical_inputs": {}}
for name in ("probe-source-manifest.json", "probe-before-manifest.json"):
    manifest = json.loads((ROOT / name).read_text())
    failures = []
    for destination, entry in manifest.items():
        path = ROOT / destination
        if digest(path) != {k: entry[k] for k in ("sha256", "bytes")} or path.read_bytes() != (ROOT / entry["packet_source"]).read_bytes():
            failures.append(destination)
    record["source_copy_checks"][name] = {"files": len(manifest), "mismatches": failures}

for stem in ("probe-public-movement", "probe-replacement"):
    record["identical_inputs"][stem] = (ROOT / (stem + "-inputs.json")).read_bytes() == (ROOT / (stem + "-before-inputs.json")).read_bytes()

record["closures"] = [
    closure("final", ["probe-public-movement.ts", "probe-replacement.ts",
                       "probe-source/snapback2/packages/evaluator/src/test-search-v5-fixtures.json"]),
    closure("before", ["probe-public-movement-before.ts", "probe-replacement-before.ts",
                        "probe-source/snapback2/packages/evaluator/src/test-search-v5-fixtures.json"]),
]
record["python"] = {"executable": sys.executable, "version": sys.version, **digest(pathlib.Path(sys.executable))}
record["packet_manifest"] = digest(PACKET / "manifest.json")
record["full_delta"] = digest(PACKET / "delta.patch")
(ROOT / "review-input-custody.json").write_text(json.dumps(record, indent=2) + "\n")
artifacts = {}
for path in sorted(ROOT.rglob("*")):
    if not path.is_file():
        continue
    relative = str(path.relative_to(ROOT))
    if relative.startswith(("probe-", "setup-failure")) or relative in {
        "REPORT.md", "custody-check.json", "runtime-hashes.json",
        "inventory-review.py", "review-input-custody.json",
    }:
        artifacts[relative] = digest(path)
(ROOT / "review-artifacts.json").write_text(json.dumps({
    "scope": "Artifacts created by this review only; excludes this inventory and supervisor live files",
    "files": artifacts,
}, indent=2) + "\n")
print(json.dumps({
    "source_copy_checks": record["source_copy_checks"],
    "identical_inputs": record["identical_inputs"],
    "closures": [{k: c[k] for k in ("prefix", "external_specifiers", "unresolved")} | {"files": len(c["files"])} for c in record["closures"]],
    "review_artifacts": len(artifacts),
}, indent=2))
