#!/usr/bin/env python3
"""Wave 34r1 (Snapback-only rerun, 0.4.46) transcript decomposition; a copy of wave34-repro/tx/parse.py with
configurable APPS/OUT and per-call reasoning/cached tokens kept. Original docstring:

Wave 34 (day one, 0.4.44) transcript decomposition. Port of wave-33 parse.py with four changes:

1. Sessions come from the lane's HARN34 archive (<lane>/.harness/sessions/manifest.json), read only;
   fallback to ~/.codex/sessions and ~/.local/share/muse/sessions.
2. **Codex call-index fix.** In a Codex rollout the `token_count` of call i is logged *after* the output of
   the tool call i issued, so wave-32/33 parse.py gave that tool k = i-1 and attributed each gap's growth
   to the tools of the *next* call (corr(gap growth, tool chars) 0.17 at the old offset, 0.99 at the fixed
   one). Here every tool carries k = the 1-based index of the call that issued it, for both models, so its
   output enters the gap D_k = C_{k+1} - C_k. Muse was already right.
3. Finer categories (TOK1's `guide api`, proof kinds, starter/generated re-reads, diary writes).
4. Diagnostic codes / error class names / failing-test lines are extracted from run outputs (codes only,
   redacted and truncated); background command lifetimes (Codex exec sessions, Muse bash_input) are tracked.

Token attribution (exact identity): sum_i C_i = N*C_1 + sum_k D_k*(N-k). D_k is split between the model's own
output of call k (its output tokens, capped at D_k) and the tool outputs in that gap (by characters).
Output: one JSON per lane in out/ (no command outputs; commands truncated + redacted).
"""
import json, os, re, sys, glob, collections

HOME = os.path.expanduser('~')
WAVE = os.environ.get('WAVE', '34')
APPS = os.environ.get('APPS', f'{HOME}/sb4-loop/bakeoff/next37/wave34r1/apps')
OUT = os.environ.get('OUT', f'{HOME}/sb4-loop/wave34r1-repro/tx/out')
os.makedirs(OUT, exist_ok=True)

SECRET = re.compile(r'(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sb_(secret|publishable)_[A-Za-z0-9_-]+|postgres(ql)?://\S+|'
                    r'(?i:(token|key|secret|password|passwd|pwd|apikey|api_key|bearer)["\']?\s*[:= ]\s*["\']?)[^\s"\']{6,}|sbp_[A-Za-z0-9]+|'
                    r'prod:[A-Za-z0-9|_-]{20,}|dev:[A-Za-z0-9|_-]{20,}|sk-[A-Za-z0-9_-]{16,}|[A-Za-z0-9+/]{40,}={0,2})')
def red(s):
    return SECRET.sub('<R>', s or '')

def ms_iso(s):
    from datetime import datetime
    return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp() * 1000

# ---------------------------------------------------------------- categorisation
def rf_kind(c):
    if re.search(r'BRIEF\.md', c): return 'brief'
    if re.search(r'PREVIOUS-', c): return 'previous'
    if re.search(r'node_modules', c): return 'node_modules'
    if re.search(r'README\.snapback|\.snapback4/(install|init)|AGENTS\.md', c): return 'starter-doc'
    if re.search(r'\.log\b|logs/|/tmp/|\.out\b|\.err\b', c): return 'logs'
    if re.search(r'DIARY|friction|REPORT|SECURITY-NOTES', c): return 'diary'
    if re.search(r'generated/|api\.ts|\.snapback4/', c): return 'generated'
    if re.search(r'package\.json|tsconfig|app\.json|vite\.config|metro\.config|babel\.config', c): return 'config'
    if re.search(r'scripts/|ACCEPTANCE\.md|DESIGN\.md', c): return 'scripts'
    return 'own'

PROOF_KIND = [
    ('acceptance', r'acceptance'), ('frontend', r'frontend[:-]proof|frontend-proof'), ('client-calls', r'client[:-]calls'),
    ('probe-check', r'probe[:-]check|serve-check'), ('probe-serve', r'probe[:-]serve'), ('staging', r'npm run staging|scripts/staging\.mjs'),
    ('verify', r'npm run (verify|proof)\b'), ('test', r'npm (run )?test\b|vitest|node --test|playwright test'),
]

HD = re.compile(r"<<-?\s*['\"]?(\w+)['\"]?[^\n]*\n.*?\n\s*\1\b", re.S)
def strip_heredoc(c):
    return HD.sub('<<HEREDOC', c)

def cat(cmd, tool=None):
    """Mechanism category for one command (or non-bash tool)."""
    if tool in ('write_file', 'edit_file', 'apply_patch'):
        return 'write-diary' if re.search(r'DIARY|friction|REPORT|SECURITY-NOTES|README\.md$', cmd or '') else 'write-file'
    if tool == 'read_file':
        pth = cmd or ''
        if re.search(r'node_modules/(snapback4|snapback4-expo)/\S*\.(d\.ts|ts|tsx|js|mjs|cjs)$', pth): return 'sb:pkg-source'
        if re.search(r'node_modules/(snapback4|snapback4-expo)/', pth): return 'sb:docs-files'
        if re.search(r'node_modules/(convex|@convex-dev)/', pth): return 'cx:pkg-source'
        if re.search(r'node_modules/@supabase/', pth): return 'sp:pkg-source'
        if re.search(r'node_modules/', pth): return 'pkg-source-other'
        return 'read-file:' + rf_kind(pth)
    if tool in ('write_todos', 'read_skill', 'view_image'):
        return 'agent-meta'
    if tool == 'sleep':
        return 'sleep/poll'
    c = cmd or ''
    lc = strip_heredoc(c)
    W = re.compile(r"(^|[;&|(]\s*)(cat\s*>|cat\s*>>|tee\s)|<<HEREDOC|apply_patch|python3? - <<|perl -pi|sed -i")
    is_write = bool(W.search(lc))
    if re.search(r'snapback4[^|;&\n]*\bguide\s+api\b', lc): return 'sb:guide-api'
    if re.search(r'snapback4[^|;&\n]*\bguide\b', lc): return 'sb:guide'
    if re.search(r'snapback4[^|;&\n]*\s--help\b|snapback4\s+help\b', lc) and not is_write: return 'sb:help'
    if re.search(r'node_modules/(snapback4|snapback4-expo)/\S*\.(md|txt|json|q)\b|snapback4[^ ]*/(docs|guide)/|/guide/[\w/-]+\.md', lc): return 'sb:docs-files'
    if re.search(r'node_modules/(snapback4|snapback4-expo)/\S*\.(d\.ts|ts|tsx|js|mjs)\b', lc): return 'sb:pkg-source'
    if re.search(r'node_modules/(snapback4|snapback4-expo)\b', lc) and re.search(r'\b(rg|grep|cat|sed|head|ls|find)\b', lc) and not is_write: return 'sb:pkg-source'
    # proofs before CLI so `npm run acceptance` (which deploys) counts as a proof run
    # MUSE1: the inherited outer regex duplicated npm in verify's pattern.
    if not is_write and re.search(r'\bnpm\s+(?:run\s+)?(?:--silent\s+)?verify\b', lc): return 'proofs:verify'
    if (not is_write) or re.search(r'&&\s*(npm run|node )', lc):
        for kind, pat in PROOF_KIND:
            if re.search(r'(npm\s+run\s+|npm\s+|node\s+\S*|npx\s+)' + r'[^|;&\n]*(' + pat + ')', lc):
                return 'proofs:' + kind
    if re.search(r'snapback4[^|;&\n]*\btest\b', lc): return 'sb:test'
    if re.search(r'snapback4[^|;&\n]*\bcheck\b', lc) and not re.search(r'snapback4[^|;&\n]*\b(deploy|rollback)\b', lc): return 'sb:check'
    if re.search(r'snapback4[^|;&\n]*\b(rollback|releases|forward)\b', lc): return 'sb:rollback'
    if re.search(r'snapback4[^|;&\n]*\bdeploy\b', lc): return 'sb:deploy'
    if re.search(r'snapback4[^|;&\n]*\b(init|new|starter|adapt)\b', lc): return 'sb:init'
    if re.search(r'snapback4[^|;&\n]*\b(token|users?|seed|sql|data|inspect|audit|admin|why)\b', lc): return 'sb:admin/data'
    if re.search(r'snapback4[^|;&\n]*\b(serve|dev|stop|serve-check|status|logs?)\b', lc): return 'sb:serve'
    if re.search(r'convex[^|;&\n]*\b(deploy|deployment)\b', lc): return 'cx:deploy'
    if re.search(r'convex[^|;&\n]*\b(dev|run|codegen|env|logs|import|export|data|function-spec)\b', lc): return 'cx:cli'
    if re.search(r'node_modules/(convex|@convex-dev)/\S*', lc): return 'cx:pkg-source'
    if re.search(r'supabase[^|;&\n]*\b(db|migration|gen|functions|link|start|status|projects|secrets)\b', lc): return 'sp:cli'
    if re.search(r'request-backend', lc): return 'backend-request'
    if (not is_write) and re.search(r'\bpsql\b|\bsqlite3\b|migrat\w*\.(m?js|ts|sql)|npm run (migrate|db[:-]\w+)|\bknex\b|drizzle-kit|prisma (migrate|db)', lc): return 'migration'
    if re.search(r'node_modules/(@supabase)/\S*', lc): return 'sp:pkg-source'
    if re.search(r'curl[^|;&\n]*(docs\.convex|supabase\.com|github|npmjs|unpkg)', lc): return 'web-docs'
    if re.search(r'node_modules/\S*\.(d\.ts|md)\b|node_modules/[^ ]*/(README|readme)|node_modules/\S*/(dist|lib|src)/', lc): return 'pkg-source-other'
    if re.search(r'\bnpm (i|install|ci|add|uninstall|update)\b|\bnpx (expo )?install\b|\bnpm (view|ls|pack)\b', lc): return 'npm-install'
    if re.search(r'npm run (check|typecheck|lint)\b|\btsc\b', lc): return 'typecheck'
    if re.search(r'npm run build|vite build|expo export|\bnpm run web\b', lc): return 'build'
    if re.search(r'\bsleep\b|\bwait\b|curl\b|\bps\b|pgrep|pkill|\bkill\b|lsof|ss -l|netstat|fuser|timeout \d+ (bash|node|npm)', lc) and not re.search(r'cat >|<<', lc): return 'serve/wait'
    if re.search(r'\bnode\b[^|;&\n]*\.(m?js|ts)\b|\bnpx tsx\b|\bnode -e\b', lc) and not re.search(r'cat >|<<', lc): return 'run-script'
    if is_write:
        return 'write-diary' if re.search(r'(cat\s*>>?|tee\s+(-a\s+)?)\s*\S*(DIARY|friction|REPORT|SECURITY-NOTES)', lc) and not re.search(r'(cat\s*>>?|tee\s)\s*(snapback/|src/|scripts/|App\.tsx)', lc) else 'write-file'
    if re.search(r'\b(cat|sed -n|head|tail|nl|less|grep|rg|find|ls|tree|wc|jq|diff|git)\b', lc): return 'read-shell:' + rf_kind(lc)
    return 'other'

READ_CATS = ('sb:guide', 'sb:guide-api', 'sb:docs-files', 'sb:pkg-source', 'sb:help', 'cx:pkg-source', 'sp:pkg-source', 'pkg-source-other', 'web-docs')
def is_read(c):
    return c in READ_CATS or c.startswith('read-file:') or c.startswith('read-shell:') or c in ('write-file', 'write-diary', 'agent-meta')

DIAG = re.compile(r'\b(?:[EWN]_[A-Z][A-Z0-9_]{2,}|SNAPBACK4?_[A-Z0-9_]{3,}|TS\d{4}|ERR_[A-Z_]{3,}|PGRST\d{3}|[A-Z][a-zA-Z]{2,}Error)\b')
FAIL = re.compile(r'^\s*(?:not ok \d+ - .*|✖ .*|✗ .*|× .*|FAIL\b.*|AssertionError.*|Error: .*|error: .*|.*\bERROR\b.*)$', re.M)
def codes_of(text):
    cs = collections.Counter(DIAG.findall(text or ''))
    return sorted(cs, key=lambda x: -cs[x])[:16]
REDSIG = re.compile(r'\b(ERR_ASSERTION|AssertionError)\b|^# fail [1-9]|^\s*(✖|not ok \d)|error TS\d{4}|check: \d+ problems?|\.q:\d+:\d+ — E_[A-Z]|'
                    r'Command failed|npm ERR!|^Error: |^\w*Error: |Uncaught|ELIFECYCLE|\bFAIL\b|failed \([1-9]\d* of|\b[1-9]\d* (tests? )?failed\b', re.M)
EXITMARK = re.compile(r'(?:EXIT|exit|CODE|code|rc|status)[ _-]?(?:code)?[:= ]\s*(\d{1,3})\b')
MASK = re.compile(r'\|\s*(head|tail|grep|rg|sed|cat|tee|less|awk)\b|\|\|\s*(true|echo|:)|;\s*(tail|cat|head|sed)\b|; true')
WRITE_RE = re.compile(r"(^|[;&|(]\s*)(cat\s*>|cat\s*>>|tee\s)|<<HEREDOC|apply_patch|python3? - <<|perl -pi|sed -i|writeFileSync|node - <<|node --input-type")
PCODE = re.compile(r'(?:— |"code"\s*:\s*"|Error: |\[|^|\s)((?:E|SNAPBACK4?)_[A-Z][A-Z0-9_]{2,})(?=[:"\]\s])', re.M)
def pcodes_of(text):
    cs = collections.Counter(PCODE.findall(text or ''))
    return sorted(cs, key=lambda x: -cs[x])[:8]
def exitmark(text):
    m = EXITMARK.findall((text or '')[-3000:])
    return int(m[-1]) if m else None
def redsig(text):
    return bool(REDSIG.search(text or ''))
def masked(cmd):
    return bool(MASK.search(cmd or ''))
def has_write(cmd):
    return bool(WRITE_RE.search(strip_heredoc(cmd or '')))

def fails_of(text):
    out = []
    for m in FAIL.finditer(text or ''):
        s = red(m.group(0).strip())[:140]
        if s and s not in out: out.append(s)
        if len(out) >= 5: break
    return out

# ---------------------------------------------------------------- codex
def js_string_at(s, i):
    """Parse a JS string literal starting at s[i] (quote char); return (value, end_index) or (None, i)."""
    if i >= len(s) or s[i] not in '"\'`': return None, i
    q = s[i]; j = i + 1; buf = []
    while j < len(s):
        ch = s[j]
        if ch == '\\' and j + 1 < len(s):
            nx = s[j + 1]
            buf.append({'n': '\n', 't': '\t', 'r': '\r', '0': '\0'}.get(nx, nx)); j += 2; continue
        if ch == q: return ''.join(buf), j + 1
        buf.append(ch); j += 1
    return ''.join(buf), j

def codex_cmds(inp):
    """Commands inside an exec JS block (robust to '})' inside heredocs)."""
    out = []
    for m in re.finditer(r'tools\.(exec_command|write_stdin|view_image|apply_patch)\(\s*\{', inp):
        kind = m.group(1); pos = m.end()
        win = inp[pos:pos + 200000]
        if kind == 'exec_command':
            mm = re.match(r'\s*(?:["\']?cmd["\']?)\s*:\s*', win)
            if not mm:
                mm2 = re.search(r'["\']?cmd["\']?\s*:\s*', win)
                if mm2: mm = mm2
            s = None
            if mm:
                s, _ = js_string_at(win, mm.end())
            out.append(('exec', s if s is not None else win[:2000]))
        elif kind == 'write_stdin':
            body = win[:400]
            sid = re.search(r'session_id\s*:\s*(\d+)', body)
            ci = re.search(r'chars\s*:\s*', body)
            chars = js_string_at(body, ci.end())[0] if ci else ''
            out.append(('poll', (sid.group(1) if sid else None, chars or '')))
        else:
            out.append((kind, win[:200]))
    if not out:
        out.append(('js', inp))
    return out

def parse_codex(path):
    ev = [json.loads(l) for l in open(path)]
    calls, tools = [], []
    pend = {}
    sessions = {}  # exec session_id -> index of originating tool record
    t0 = ms_iso(ev[0]['timestamp']); tend = ms_iso(ev[-1]['timestamp'])
    last = None; model_ms = collections.defaultdict(float); first_issue = {}
    for e in ev:
        p = e.get('payload') or {}
        ts = ms_iso(e['timestamp'])
        ty = p.get('type') if isinstance(p, dict) else None
        if e['type'] == 'event_msg' and ty == 'task_started':
            last = ts
        elif e['type'] == 'event_msg' and ty == 'token_count' and p.get('info'):
            u = p['info']['last_token_usage']
            calls.append({'t': ts, 'in': u['input_tokens'], 'out': u['output_tokens'] + 0, 'reason': u.get('reasoning_output_tokens', 0),
                          'cached': u.get('cached_input_tokens', 0)})
        elif e['type'] == 'event_msg' and ty == 'task_complete':
            if last is not None: model_ms[len(calls) + 1] += ts - last; last = None
        elif e['type'] == 'response_item' and ty in ('custom_tool_call', 'function_call'):
            if ty == 'custom_tool_call':
                cmds = codex_cmds(p.get('input', '')); name = p['name']
            else:
                cmds = [('sleep', p.get('arguments', ''))] if p.get('name') == 'sleep' else [(p.get('name'), p.get('arguments', ''))]
                name = p.get('name')
            k = len(calls) + 1   # FIX: the issuing call's token_count arrives after this tool's output
            if last is not None:
                model_ms[k] += ts - last; last = None
            pend[p['call_id']] = {'t0': ts, 'cmds': cmds, 'name': name, 'k': k, 'inlen': len(p.get('input', '') or p.get('arguments', '') or '')}
        elif e['type'] == 'response_item' and ty in ('custom_tool_call_output', 'function_call_output'):
            last = ts
            c = pend.pop(p.get('call_id'), None)
            if not c: continue
            o = p.get('output')
            text = ''.join(x.get('text', '') for x in o) if isinstance(o, list) else str(o or '')
            chunks = []
            if isinstance(o, list):
                for x in o[1:]:
                    tx = x.get('text', '')
                    try: j = json.loads(tx)
                    except Exception: j = None
                    chunks.append((tx, j))
            inner = [cc for cc in c['cmds'] if cc[0] in ('exec', 'poll')]
            paired = len(chunks) == len(inner) and len(inner) > 0 and all(j is not None for _, j in chunks)
            units = []
            if paired:
                for (kind, v), (tx, j) in zip(inner, chunks):
                    body = j.get('output') if isinstance(j.get('output'), str) else tx
                    units.append((kind, v, len(tx), j.get('exit_code'), j.get('session_id'), j.get('wall_time_seconds'), body))
            else:
                first = c['cmds'][0]
                exits = [int(x) for x in re.findall(r'"exit_code"\s*:\s*(-?\d+)', text)]
                sids = re.findall(r'"session_id"\s*:\s*(\d+)', text)
                units.append((first[0], first[1], len(text), exits[0] if exits else None, sids[0] if sids else None, None, text))
            span_ms = ts - c['t0']; tot_w = sum((u[5] or 0) for u in units) or 0
            for i, (kind, v, ln, ex, sid, wall, body) in enumerate(units):
                origin = None
                if kind == 'exec':
                    category = cat(v); cmdtxt = v
                elif kind == 'poll':
                    origin = sessions.get(str(v[0]))
                    ocat = tools[origin]['cat'] if origin is not None else 'unknown'
                    category = 'poll:' + ocat; cmdtxt = f'write_stdin session {v[0]} {v[1][:40]!r}'
                elif kind == 'sleep':
                    category = 'sleep/poll'; cmdtxt = 'sleep ' + str(v)
                else:
                    category = cat(None, kind); cmdtxt = str(v)
                share = (wall / tot_w) if (tot_w and wall is not None) else 1 / len(units)
                a0 = c['t0'] + span_ms * sum(((units[j][5] / tot_w) if (tot_w and units[j][5] is not None) else 1 / len(units)) for j in range(i))
                base_cat = category[5:] if category.startswith('poll:') else category
                rec = {'t0': a0, 't1': a0 + span_ms * share, 'k': c['k'], 'cat': category, 'cmd': red(cmdtxt)[:300], 'len': ln,
                       'exit': ex, 'nonzero': (ex is not None and ex != 0), 'n_inner': len(units), 'inlen': c['inlen'] if i == 0 else 0,
                       'running': (sid is not None and ex is None), 'sid': sid, 'origin': origin,
                       'w': has_write(cmdtxt) if kind == 'exec' else False, 'sig': redsig(body) if not is_read(base_cat) else False,
                       'masked': masked(cmdtxt) if kind == 'exec' else False,
                       'codes': codes_of(body) if not is_read(base_cat) else [],
                       'pcodes': pcodes_of(body) if not is_read(base_cat) else [], 'xm': exitmark(body) if not is_read(base_cat) else None,
                       'fails': fails_of(body) if (ex not in (None, 0) and not is_read(base_cat)) else []}
                tools.append(rec)
                idx = len(tools) - 1
                if kind == 'exec' and sid is not None:
                    sessions.setdefault(str(sid), idx)
                    tools[idx]['bg_start'] = a0
                if origin is not None and ex is not None:
                    tools[origin]['final_exit'] = ex; tools[origin]['bg_end'] = a0 + span_ms * share
                    tools[origin]['sig'] = tools[origin].get('sig') or rec['sig']
                    tools[origin]['pcodes'] = sorted(set(tools[origin].get('pcodes') or []) | set(rec['pcodes']))[:8]
                    if rec['xm'] is not None: tools[origin]['xm'] = rec['xm']
                    if tools[origin].get('fails') == [] and ex != 0: tools[origin]['fails'] = rec['fails']
                    tools[origin]['codes'] = sorted(set(tools[origin].get('codes', [])) | set(rec['codes']))[:16]
                if kind == 'exec' and ex is not None:
                    tools[idx]['final_exit'] = ex
    for i, c in enumerate(calls):
        c['mt'] = model_ms.get(i + 1, 0) / 1000
    return {'t0': t0, 't1': tend, 'calls': calls, 'tools': tools}

# ---------------------------------------------------------------- muse
def parse_muse(path):
    calls, tools = [], []
    pend = {}
    t0 = None; t1 = None
    starts = {}; ends = {}
    bgcmd = {}   # background command text -> index of originating record
    for l in open(path):
        try: o = json.loads(l)
        except Exception: continue
        for ch in (o.get('children') or [o]):
            rj = ch.get('record_json')
            try: r = json.loads(rj) if rj else ch
            except Exception: continue
            ra = r.get('recorded_at')
            ts = ra / 1000 if isinstance(ra, (int, float)) and ra > 1e15 else None
            if ts:
                t0 = ts if t0 is None else min(t0, ts); t1 = ts if t1 is None else max(t1, ts)
            pt = r.get('payload_type')
            if pt in ('tool_batch.effect.started', 'tool_batch.effect.terminal'):
                rec = r['payload']['record']
                (starts if pt.endswith('started') else ends)[rec['call_id']] = ts
                continue
            if pt != 'runtime.session': continue
            evn = (r['payload'].get('event') or {})
            k = evn.get('kind')
            if k == 'model_completed':
                u = evn.get('usage') or {}
                calls.append({'t': ts, 'in': u.get('input_tokens', 0), 'out': u.get('output_tokens', 0), 'reason': u.get('reasoning_tokens', 0),
                              'dur': evn.get('duration_ms'), 'mt': (evn.get('duration_ms') or 0) / 1000,
                              'cached': u.get('cache_read_tokens') or u.get('cached_tokens') or u.get('cache_read_input_tokens') or 0})
            elif k == 'assistant_tool_calls_committed':
                for tc in evn.get('tool_calls', []):
                    try: a = json.loads(tc.get('args') or '{}')
                    except Exception: a = {}
                    name = tc.get('name')
                    cmd = a.get('command') if name == 'bash' else (a.get('path') or '')
                    pend[tc['call_id']] = {'name': name, 'cmd': cmd, 'k': len(calls), 't0': ts, 'inlen': len(tc.get('args') or ''),
                                           'bg': bool(a.get('run_in_background') or a.get('background'))}
            elif k == 'tool_result_batch_committed':
                res = evn.get('results', [])
                ids = [cid for cid in pend if pend[cid]['k'] == len(calls)]
                for i, rr in enumerate(res):
                    cid = rr.get('call_id') or (ids[i] if i < len(ids) else None)
                    c = pend.pop(cid, None) if cid else None
                    if not c: continue
                    text = rr.get('text') or ''
                    mexit = re.search(r'"exit_code"\s*:\s*(-?\d+)', text)
                    st = starts.get(cid, c['t0']); en = ends.get(cid, ts)
                    category = cat(c['cmd'], c['name']) if c['name'] != 'bash' else cat(c['cmd'])
                    origin = None
                    if c['name'] == 'bash_input':
                        mcmd = re.search(r'"command":\s*"((?:[^"\\]|\\.)*)"', text)
                        try: pc = json.loads('"' + mcmd.group(1) + '"') if mcmd else ''
                        except Exception: pc = mcmd.group(1) if mcmd else ''
                        category = 'poll:' + (cat(pc) if pc else 'unknown')
                        origin = bgcmd.get((pc or '')[:200])
                        c['cmd'] = 'bash_input <- ' + (pc or '?')
                    base_cat = category[5:] if category.startswith('poll:') else category
                    ex = int(mexit.group(1)) if mexit else None
                    running = '"terminal_status": "running"' in text or '"status": "running"' in text or c.get('bg', False)
                    rec = {'t0': st, 't1': en, 'k': c['k'], 'cat': category, 'cmd': red(c['cmd'] or c['name'])[:300], 'len': len(text),
                           'exit': ex, 'nonzero': bool(mexit and mexit.group(1) != '0'), 'n_inner': 1, 'inlen': c['inlen'],
                           'running': running, 'origin': origin, 'timeout': bool(re.search(r'timed out|"timed_out":\s*true|timeout after', text[:2000], re.I)),
                           'w': has_write(c['cmd']) if c['name'] == 'bash' else c['name'] in ('write_file', 'edit_file'),
                           'sig': redsig(text) if not is_read(base_cat) else False, 'masked': masked(c['cmd']) if c['name'] == 'bash' else False,
                           'codes': codes_of(text) if not is_read(base_cat) else [],
                           'pcodes': pcodes_of(text) if not is_read(base_cat) else [], 'xm': exitmark(text) if not is_read(base_cat) else None,
                           'fails': fails_of(text) if (ex not in (None, 0) and not is_read(base_cat)) else []}
                    tools.append(rec); idx = len(tools) - 1
                    if c['name'] == 'bash' and running:
                        bgcmd[(c['cmd'] or '')[:200]] = idx; tools[idx]['bg_start'] = st
                    if ex is not None and origin is None: tools[idx]['final_exit'] = ex
                    if origin is not None and ex is not None:
                        tools[origin]['final_exit'] = ex; tools[origin]['bg_end'] = en
                        tools[origin]['sig'] = tools[origin].get('sig') or rec['sig']
                        tools[origin]['pcodes'] = sorted(set(tools[origin].get('pcodes') or []) | set(rec['pcodes']))[:8]
                        if rec['xm'] is not None: tools[origin]['xm'] = rec['xm']
                        tools[origin]['codes'] = sorted(set(tools[origin].get('codes', [])) | set(rec['codes']))[:16]
                        if ex != 0 and not tools[origin].get('fails'): tools[origin]['fails'] = rec['fails']
    return {'t0': t0, 't1': t1, 'calls': calls, 'tools': tools}

# ---------------------------------------------------------------- attribution
def attribute(s):
    calls, tools = s['calls'], s['tools']
    N = len(calls)
    res = {'N': N, 'sumC': sum(c['in'] for c in calls), 'C1': calls[0]['in'] if calls else 0,
           'cats_tok': collections.Counter(), 'cats_rawtok': collections.Counter(), 'model_out_tok': 0, 'base_tok': 0, 'compaction': 0}
    if not N: return res
    res['base_tok'] = calls[0]['in'] * N
    by_gap = collections.defaultdict(list)
    for t in tools:
        by_gap[t['k']].append(t)   # tool issued by call k (1-based) -> output enters before call k+1
    for k in range(1, N):
        D = calls[k]['in'] - calls[k - 1]['in']
        rem = N - k
        if D < 0:
            res['compaction'] += 1
            continue
        mo = min(D, calls[k - 1]['out'])
        res['model_out_tok'] += mo * rem
        left = D - mo
        g = by_gap.get(k, [])
        L = sum(max(1, t['len']) for t in g)
        for t in g:
            share = left * max(1, t['len']) / L if L else 0
            t['tok'] = share; t['cost'] = share * rem
            res['cats_tok'][t['cat']] += share * rem
            res['cats_rawtok'][t['cat']] += share
        if not g and left > 0:
            res['cats_tok']['unattributed'] += left * rem
            res['cats_rawtok']['unattributed'] += left
    return res

def timing(s):
    tools = s['tools']
    span = (s['t1'] - s['t0']) / 60000 if s['t0'] else 0
    iv = sorted((t['t0'], t['t1'], t['cat']) for t in tools if t['t0'] and t['t1'])
    cat_min = collections.Counter()
    # union-split: each instant of tool time is shared by the tools running then
    pts = sorted(set([a for a, b, c in iv] + [b for a, b, c in iv]))
    for x0, x1 in zip(pts, pts[1:]):
        act = [c for a, b, c in iv if a <= x0 and b >= x1]
        for c in act: cat_min[c] += (x1 - x0) / 60000 / len(act)
    union = 0; cur = None
    for a, b, c in iv:
        if cur is None or a > cur[1]:
            if cur: union += cur[1] - cur[0]
            cur = [a, b]
        else: cur[1] = max(cur[1], b)
    if cur: union += cur[1] - cur[0]
    return {'span': span, 'tool_min': union / 60000, 'model_min': span - union / 60000, 'cat_min': cat_min,
            'model_dur_min': sum((c.get('mt') or 0) for c in s['calls']) / 60}

def lane_sessions(lane):
    d = f'{APPS}/{lane}/.harness/sessions'
    files = []
    try:
        man = json.load(open(f'{d}/manifest.json'))
        for s in man.get('sessions', []):
            for fn in s.get('files', []):
                if os.path.exists(f'{d}/{fn}'): files.append((s['model'], f'{d}/{fn}'))
    except Exception:
        pass
    if files: return files
    # fallback: thread/session ids from the transcript
    p = f'{APPS}/{lane}/.agent.ndjson'
    th, ms = [], []
    with open(p, errors='replace') as f:
        for l in f:
            if '"thread.started"' in l:
                m = re.search(r'"thread_id":"([^"]+)"', l)
                if m: th.append(m.group(1))
            elif '"stream":{"kind":"session","id":"' in l and '"sequence":1,' in l:
                m = re.search(r'"stream":\{"kind":"session","id":"([^"]+)"', l)
                if m and m.group(1) not in ms: ms.append(m.group(1))
    for t in th:
        g = glob.glob(f'{HOME}/.codex/sessions/2026/10/2[6-8]/rollout-*-{t}.jsonl')
        if g: files.append(('codex', g[0]))
    for m in ms:
        g = glob.glob(f'{HOME}/.local/share/muse/sessions/2026/10/2[6-8]/{m}/session.jsonl')
        if g: files.append(('muse', g[0]))
    return files

def one(lane):
    try:
        files = lane_sessions(lane)
    except Exception as e:
        return lane, 'ERR ' + str(e)
    out = {'lane': lane, 'sessions': []}
    for kind, f in files:
        s = parse_codex(f) if kind == 'codex' else parse_muse(f)
        a = attribute(s); tm = timing(s)
        t0 = s['t0'] or 0
        rep = collections.Counter(t['cmd'][:120] for t in s['tools'])
        keep = ('k', 'cat', 'cmd', 'len', 'tok', 'cost', 'exit', 'final_exit', 'nonzero', 'n_inner', 'inlen', 'running', 'sid', 'origin', 'codes', 'fails', 'timeout', 'w', 'sig', 'masked', 'pcodes', 'xm')
        out['sessions'].append({'kind': kind, 'file': os.path.basename(f), 'N': a['N'], 'sumC': a['sumC'], 'C1': a['C1'],
            'meanC': a['sumC'] / a['N'] if a['N'] else 0, 'maxC': max((c['in'] for c in s['calls']), default=0),
            'out_tok': sum(c['out'] for c in s['calls']), 'cached': sum(c.get('cached') or 0 for c in s['calls']),
            'base_tok': a['base_tok'], 'model_out_tok': a['model_out_tok'],
            'compaction': a['compaction'], 'cats_tok': a['cats_tok'], 'cats_rawtok': a['cats_rawtok'], 'timing': tm,
            'n_tools': len(s['tools']), 'nonzero': sum(1 for t in s['tools'] if t['nonzero']),
            'calls': [{'t': round((c['t'] - t0) / 1000, 2) if c.get('t') else None, 'in': c['in'], 'out': c['out'], 'mt': round(c.get('mt') or 0, 2), 'reason': c.get('reason') or 0, 'cached': c.get('cached') or 0} for c in s['calls']],
            'tools': [{k: t.get(k) for k in keep} | {'sec': round((t['t1'] - t['t0']) / 1000, 1) if t['t0'] and t['t1'] else None,
                       'ts': round((t['t0'] - t0) / 1000, 1) if t['t0'] else None,
                       'bg_sec': round((t['bg_end'] - t['bg_start']) / 1000, 1) if t.get('bg_end') and t.get('bg_start') else None} for t in s['tools']],
            'repeats': [(c, n) for c, n in rep.most_common(8) if n > 1]})
    json.dump(out, open(f'{OUT}/{lane}.json', 'w'), default=float)
    return lane, [(x['kind'], x['N'], x['sumC']) for x in out['sessions']]

if __name__ == '__main__':
    lanes = sys.argv[1:] or sorted(os.listdir(APPS))
    from multiprocessing import Pool
    with Pool(int(os.environ.get('PAR', '8'))) as pool:
        for lane, r in pool.imap_unordered(one, lanes):
            print(lane, r, flush=True)
