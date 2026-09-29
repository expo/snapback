"""Render all retained untraced curves, physical counters and rule margins."""
import pathlib,json,statistics
base=pathlib.Path('target/sq');out=pathlib.Path(__file__).resolve().parent.parent
s=json.loads((base/'summary.json').read_text());physical=json.loads((base/'physical.json').read_text())
lines=['# Every retained curve and frozen rule','', 'Untraced measurements only. Each point is median batch p50 / median batch p95 / maximum of all samples (ms). Ten-sample p95 is the maximum. Immediate live runs have one batch; warm runs have nine. Traced timings never qualify a latency rule.','']
for tag,x in s.items():
 if tag.startswith('trace-'):continue
 lines += ['## '+tag,'','| Probe | '+ ' | '.join(next(iter(x['points'].values())).keys())+' |','| --- | '+ ' | '.join('---:' for _ in next(iter(x['points'].values())))+' |']
 for name,ps in x['points'].items():lines.append('| '+name+' | '+' | '.join(f"{p['p50']:.3f} / {p['p95']:.3f} / {p['max']:.3f}" for p in ps.values())+' |')
 lines+=['','| Frozen rule | Measured | Ceiling | Margin | Result | Rounds passing |','| --- | ---: | ---: | ---: | --- | ---: |']
 for name,r in x['rules'].items():
  rounds=[v['rules'][name]['pass'] for v in x['roundRules'] if name in v['rules']]
  lines.append(f"| {name} | {r['measured']:.3f} | {r['ceiling']:.3f} | {r['margin']:+.3f} {r['units']} | {'Pass' if r['pass'] else 'Fail'} | {sum(rounds)}/{len(rounds)} |")
 lines+=['','Every individual round margin is retained in evidence/summary.json.','']
w=json.loads((base/'live/evidence/replay/verification-final.json').read_text())['probes'];ratio=w['celebrityWrite']['p95']/w['fiveFollowerWrite']['p95']
lines+=['## Frozen write rule (full verified replay, same unchanged product)','',f"Celebrity write p95 {w['celebrityWrite']['p95']:.3f} ms ({w['celebrityWrite']['n']} writes); five-follower author p95 {w['fiveFollowerWrite']['p95']:.3f} ms ({w['fiveFollowerWrite']['n']} writes). Ratio {ratio:.3f} <= 3; margin {3-ratio:+.3f}; {'Pass' if ratio<=3 else 'Fail'}. Read-only before/after controls do not remeasure this rule.",'']
(out/'CURVES.md').write_text('\n'.join(lines))
lines=['# Per-query SQLite cache and syscall measurements','', 'Cells are mean cache hits / cache misses / pread64 calls per actual server query. Three warmups per operation precede the one traced round; switching probes can evict previously warmed pages. Each original batch has ten queries; queued 16 MiB includes an additional SDK read and retains it. There was no OS-cache flush.','']
for config in ['small','default','16m','256m','mmap','both']:
 lines+=['## '+config,'','| Probe | 10% | 50% | Full |','| --- | ---: | ---: | ---: |']
 for name in physical['trace-default-full']:
  cells=[]
  for st in ['10pct','50pct','full']:
   p=physical[f'trace-{config}-{st}'][name];cells.append(f"{p['hits']:.1f} / {p['misses']:.1f} / {p['pread']:.1f}")
  lines.append('| '+name+' | '+' | '.join(cells)+' |')
 lines+=['']
lines+=['## While the same retained 50% backlog drains','', '| Probe | Default misses / pread | 16 MiB misses / pread | Mmap misses / pread |','| --- | ---: | ---: | ---: |']
for name in physical['trace-default-full']:
 cells=[]
 for config in ['default','16m','mmap']:
  p=physical[f'trace-queued-{config}-queued-{config}'][name];cells.append(f"{p['misses']:.1f} / {p['pread']:.1f}")
 lines.append('| '+name+' | '+' | '.join(cells)+' |')
lines+=['','The configurations share the initial pending snapshot. Delivery proceeds during each run, so the precise committed position differs. This experiment establishes the syscall mechanism, not a paired latency speedup. Mmap was requested at 8 GiB; the bundled SQLite clamps it to 2,147,418,112 B.','', '| Queued configuration | Query count | File-lock busy results | Busy-sleep ms | Queries overlapping checkpoint lock | Max per-query futex ms |','| --- | ---: | ---: | ---: | ---: | ---: |']
for config in ['default','16m','mmap']:
 rows=[q for p in physical[f'trace-queued-{config}-queued-{config}'].values() for q in p['samples']]
 lines.append(f"| {config} | {len(rows)} | {sum(q['lockBusy'] for q in rows)} | {sum(q['busySleepMs'] for q in rows):.3f} | {sum(q['checkpointOverlapMs']>0 for q in rows)} | {max(q['futexMs'] for q in rows):.3f} |")
lines+=['','Per-read file-lock call time, futex call time, busy sleep, and checkpoint-lock overlap are in evidence/physical.json.gz. Overlap is not time waiting for a checkpoint; CPU descheduling and shared I/O pressure remain inseparable here. Kernel call durations include tracer overhead. No checkpoint executes on a detached read connection.','']
(out/'PHYSICAL.md').write_text('\n'.join(lines))
