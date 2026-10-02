#!/usr/bin/env python3
"""Temporary built-JS tracing. A normal SDK build removes it; no shipping hooks."""
from pathlib import Path
root = Path(__file__).resolve().parents[3] / "packages/snapback4/dist"
for name, old, new in [
    ("app-client.js", "export function guardClient(raw, check, validScope, why, retireStore, admit) {", """export function guardClient(raw, check, validScope, why, retireStore, admit) {
    const bgCheck = check;
    check = async () => {
        const id = globalThis.crypto?.randomUUID?.();
        globalThis.__bgTrace?.('facade-start', {id});
        try { return await bgCheck(); }
        finally { globalThis.__bgTrace?.('facade-end', {id}); }
    };"""),
    ("local-reads.js", "export function notifyLocalWatch(watch) {", """export function notifyLocalWatch(watch) {
    globalThis.__bgTrace?.('raw-read', {name: watch.op.name, read: watch.snapshot});"""),
]:
    path = root / name
    source = path.read_text()
    assert source.count(old) == 1 and "const bgCheck" not in source, name
    path.write_text(source.replace(old, new))
