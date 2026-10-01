"""Classify the complete syntax census; compact tables retain every source site."""
from pathlib import Path
import collections,json,re
report=Path(__file__).resolve().parent
rows=json.loads((report/'audit-sites.json').read_text())
clock_files={'ephemeral-adoption.test.mjs','ephemeral-e2e.test.mjs','ephemeral-watches.test.mjs','transport-http.test.mjs','keepalive-retry.test.mjs','keepalive-headers.test.mjs','admit-before-identity.test.mjs','server-clock-wire.test.mjs','server-clock-browser.test.mjs','presence-refresh.test.mjs','online-store-order.test.mjs','asset-retry.test.mjs','overload.test.mjs','worker-regressions.test.mjs','client-seams.test.mjs'}
def classify(r):
 f=Path(r['file']).name;t=r['text'];kind=r['kind']
 if t.startswith('Promise.race'):
  if f=='keepalive-retry.test.mjs':return 'product-timing'
  if f=='upload-lifetime.test.mjs':return 'semantic-schedule-or-observation-window'
  if f in {'worker.test.mjs','server-e2e.test.mjs','routes.mjs'} and re.search(r'delay|sleep|setTimeout',t):return 'cleanup-only'
  if re.search(r'delay|sleep|setTimeout',t):return 'incidental-guard'
  return 'data-or-order-assertion'
 if f.startswith('proxy-') and kind=='call':
  if re.search(r'waitForProofDrain\(5\)|stopOwnedChild\(child, owned, 5\)|run.close\(5,',t):return 'intentional-timeout'
  if re.search(r'waitForProofDrain\(20\)|stopOwnedChild\(child, owned, 20\)',t) and f=='proxy-phase.test.mjs':return 'synchronous-control'
  if re.search(r'settlesWithin|waitForProofDrain|stopOwnedChild',t):return 'incidental-guard'
 if kind=='option':
  if f=='measure-launch.test.mjs' and not re.search(r'10_000|hangBudget',t) or f=='publication-roundtrip.test.mjs' and re.search(r'60_?000',t):return 'data-contract'
  if re.search(r'timeoutMs:\s*elapsed',t):return 'clock-data-instrumentation-or-source-text'
  if f=='native-smoke.test.mjs' or f=='witness.test.mjs' and re.search(r'timeoutMs:\s*10\b',t):return 'intentional-timeout'
  if any(w in t for w in ['count * 2000','seeds * schedulesPerSeed']):return 'work-scaled-guard'
  return 'incidental-guard'
 if re.search(r'\b(?:hangBudget|withHangGuard|awaitState|waitFor|until|turns)\(',t) and kind=='call':return 'incidental-guard'
 if 'AbortSignal.timeout' in t:
  return 'intentional-timeout' if 'timeout(150)' in t else 'incidental-guard'
 if kind=='loop':
  if f=='ephemeral-e2e.test.mjs' and 'performance.now() < deadline' in t:return 'clock-data-instrumentation-or-source-text'
  if f=='per-row-publication.test.mjs' and 'i<80' in t:return 'incidental-guard'
  if f.startswith('per-row-') and re.search(r'for.*(?:i < 60|i<60|i < 20|i < 10).*await.*(?:pause|setImmediate)',t) and len(t)<300:return 'semantic-schedule-or-observation-window'
  if re.search(r'Date.now\(|performance.now\(|deadline|\buntil\b',r.get('condition',t)):
   return 'product-timing' if f=='ephemeral-e2e.test.mjs' else 'incidental-guard'
  return 'logical-work-or-state-loop'
 if kind=='assertion':
  if f=='client-seams.test.mjs' and 'elapsed < 1000' in t:return 'incidental-guard'
  if f=='server-clock-browser.test.mjs' and ('ms <= 1000' in t or 'Date.now() - before < 3000' in t):return 'incidental-guard'
  if f=='admit-before-identity.test.mjs' and 'performance.now() - start < 90_000' in t:return 'incidental-guard'
  if f=='one-shot-model.test.mjs' and 'performance.now() - started < 30_000' in t:return 'incidental-guard'
  if f=='http-bounds.test.mjs' and 'Date.now() - started < 500' in t:return 'incidental-guard'
  if f=='server-clock-wire.test.mjs' and any(x in t for x in ['Math.abs(at - Date.now()', 'Math.abs(sent.at - Date.now()', 'Math.abs(r.now - Date.now()']):return 'incidental-guard'
  if f=='ephemeral-e2e.test.mjs' and ('measure.ephemeralFirstMs' in t or 'measure.ephemeralGoneAfterLastMs' in t):return 'product-timing'
  if t.startswith(('assert.equal(', 'assert.notEqual(', 'assert.deepEqual(', 'assert.match(')) and 'delays' not in t:return 'data-or-order-assertion'
  if f=='ephemeral-e2e.test.mjs' and 'delivery?.at' in t:return 'data-or-order-assertion'
  if f in clock_files and re.search(r'(?:elapsed|\.now\(|times\[|reads\[|delays|\.at\b|\.ms\b|deliveryMs|detectionMs)',t):return 'product-timing'
  return 'data-or-order-assertion'
 if re.search(r'setTimeout.*(?:reject|assert.fail|throw Error)|(?:setDefaultTimeout|setDefaultNavigationTimeout)\(',t):return 'incidental-guard'
 if re.search(r'(?:SIGKILL|\.kill\()',t) and 'setTimeout' in t:return 'cleanup-only'
 if re.search(r'(?:\bdelay|\bsleep|waitForTimeout|setTimeout|setInterval)\(',t):return 'semantic-schedule-or-observation-window'
 if '--timeout' in t:
  return 'data-contract' if re.search(r'marker|unknown|--timeout.*-1',t) else 'incidental-guard'
 return 'clock-data-instrumentation-or-source-text'
for r in rows:r['classification']=classify(r)
(report/'audit-sites.json').write_text(json.dumps(rows,indent=2)+'\n')
for version in ['before','after']:
 with (report/f'audit-{version}.tsv').open('w') as out:
  out.write('file\tline\tkind\tclassification\tsource\n')
  for r in sorted((r for r in rows if r['version']==version),key=lambda r:(r['file'],r['line'],r['kind'])):
   out.write('\t'.join(str(r[k]).replace('\t',' ').replace('\n',' ') for k in ['file','line','kind','classification','text'])+'\n')
counts=collections.Counter(r['classification'] for r in rows if r['version']=='after')
(report/'audit-counts.json').write_text(json.dumps(counts,indent=2)+'\n')
# Every original explicit timeout option, including the deliberately retained data.
with (report/'BUDGET-SITES.md').open('w') as out:
 out.write('# Explicit timeout options\n\nAll original option sites in the scoped tree. Line numbers refer to the starting commit.\n\n`incidental-guard` options now use `hangBudget(work)` (or the shared guarded fixture); pre-existing work-scaled guards and deliberate timing inputs remain. See AUDIT.md for implicit browser limits, polling functions, races, timing assertions and observation windows.\n\n| File:line | Original option | Classification |\n|---|---|---|\n')
 for r in sorted((r for r in rows if r['version']=='before' and r['kind']=='option'),key=lambda r:(r['file'],r['line'])):
  out.write(f"| `{r['file']}:{r['line']}` | `{r['text'].replace('|','&#124;')}` | {r['classification']} |\n")
print(dict(counts))
