#!/usr/bin/env python3
"""Deterministic rendering: existing bytes must match; no overwrite."""
from common import ROOT, NATIVE, BACKENDS, PORTS, put

PLATFORM = {
 'snapback4': 'Build on published snapback4@0.4.13 and snapback4-expo@0.4.13, exact pins. '
 'Read the installed package README in full, then use npx snapback4 guide, keyword cards, '
 'npx snapback4 why <CODE>, generated types and diagnostics. Backend authoring is Quarry '
 '(snapback/*.q). Use the published React/local-replica and Expo arms. Do not inspect '
 'a source checkout or replace a published binary. Record exact diagnostics for platform gaps.',
 'convex': 'Build on published convex@1.45.0, exactly the Sept 16 npm pin. Use its installed '
 'package, CLI and public documentation. The operator preflight proved local foreground '
 'stop/restart, durable data and client reconnect with backend precompiled-2026-09-28-5c7cb5b. '
 'Use that recorded backend binary through CLIQUE_CONVEX_BACKEND, not a moving download. '
 'Use CONVEX_AGENT_MODE=anonymous or explicit self-hosted local configuration. Hosted '
 'deployment and client offline toggles cannot substitute for foreground backend ownership.'
}

def rendered(backend):
    text = (ROOT / 'prompts/template.md').read_text()
    values = {'LANE': str(ROOT / 'lanes' / backend), 'BACKEND': backend,
              'PLATFORM': PLATFORM[backend], 'PORTS': '%s–%s' % PORTS[backend],
              'NATIVE_PROMPT': (NATIVE / 'builder-prompt.md').read_text().strip()}
    for key, value in values.items(): text = text.replace('@' + key + '@', value)
    return text

def main():
    for backend in BACKENDS:
        text = rendered(backend); path = ROOT / 'prompts' / (backend + '.md')
        if path.exists():
            if path.read_text() != text: raise RuntimeError('render-drift:' + backend)
        else: put(path, text)
        print('rendered/verified:', backend)

if __name__ == '__main__': main()
