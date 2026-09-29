"""Pair per-query connection counters with that thread's timed syscalls."""
import pathlib,json,re,statistics,gzip
base=pathlib.Path('target/sq');names=['busyHistory','following500','following5','celebrityFollower','search100','insights','trending'];out={}
def joined_calls(text):
 pending={}
 for line in text.splitlines():
  start=re.match(r'(\d+)\s+\d+\.\d+\s+(\w+)\(.* <unfinished \.\.\.>$',line)
  resume=re.match(r'(\d+)\s+\d+\.\d+\s+<\.\.\. (\w+) resumed>(.*)',line)
  if start:
   key=(start[1],start[2]);assert key not in pending,key
   pending[key]=line.removesuffix(' <unfinished ...>')
  elif resume:
   key=(resume[1],resume[2]);assert key in pending,key
   yield pending.pop(key)+resume[3]
  else:yield line
 # Owned processes are terminated after the probes; sleeping worker calls can
 # end at termination. Preserve them as starts, without invented durations.
 yield from pending.values()
for p in sorted(base.glob('trace-*.log')):
 key=p.stem;events=[json.loads(l[7:]) for l in p.read_text().splitlines() if l.startswith('SQ_END ')]
 trace=p.with_suffix('.strace');calls=[];held={};checkpoints=[]
 for line in joined_calls(trace.read_text()):
  lock=re.match(r'(\d+)\s+(\d+\.\d+)\s+fcntl\(.*store.sqlite-shm.*l_type=(F_WRLCK|F_UNLCK).*l_start=121, l_len=1.*= 0',line)
  if lock:
   tid=int(lock[1]);at=float(lock[2])
   if lock[3]=='F_WRLCK':held[tid]=at
   elif tid in held:checkpoints.append((held.pop(tid),at))
  m=re.match(r'(\d+)\s+(\d+\.\d+)\s+(pread64|read|fcntl|fsync|fdatasync|clock_nanosleep|futex)\(.*',line)
  if not m:continue
  d=re.search(r'<([\d.]+)>$',line)
  calls.append((int(m[1]),float(m[2]),m[3],float(d[1]) if d else 0.,m[3]=='fcntl' and ('EAGAIN' in line or 'EACCES' in line),d is not None))
 # Select by the recorded client interval, not a positional offset: the SDK
 # can issue an extra successful read while a delivery commit is observed.
 candidates=[]
 for curve in base.glob('trace-*-curve.json'):
  x=json.loads(curve.read_text())
  for batch in x['rounds']:
   if key==curve.stem.removesuffix('-curve')+'-'+batch['stage']:candidates.append(batch)
 assert len(candidates)==1,(key,len(candidates))
 batch=candidates[0]
 out[key]={}
 for i,name in enumerate(names):
  probe=batch['probes'][name];low=probe['timestamps'][0]/1000
  high=batch['probes'][names[i+1]]['timestamps'][0]/1000 if i+1<len(names) else (probe['timestamps'][-1]+probe['times'][-1]+1)/1000
  op=probe['serverTiming'][0]['op']
  group=[q for q in events if low<=q['start']<high and q['op']==op];samples=[]
  assert len(group)==len(probe['serverTiming']),(key,name,len(group),len(probe['serverTiming']))
  for q in group:
   matches=[c for c in calls if c[0]==q['tid'] and q['start']<=c[1]<=q['end']]
   assert all(c[5] for c in matches),(key,name,'unfinished query-thread syscall')
   sample=dict(q,calls={n:sum(c[2]==n for c in matches) for n in ['pread64','read','fcntl','clock_nanosleep','futex']},lockBusy=sum(c[4] for c in matches),checkpointOverlapMs=sum(max(0,min(end,q['end'])-max(start,q['start']))*1000 for start,end in checkpoints),busySleepMs=sum(c[3]*1000 for c in matches if c[2]=='clock_nanosleep'),futexMs=sum(c[3]*1000 for c in matches if c[2]=='futex'),lockSyscallMs=sum(c[3]*1000 for c in matches if c[2]=='fcntl'))
   samples.append(sample)
  out[key][name]={'serverRequests':len(group),'appReads':len(probe['times']),'hits':statistics.mean(q['hits'] for q in samples),'misses':statistics.mean(q['misses'] for q in samples),'pread':statistics.mean(q['calls']['pread64'] for q in samples),'ms':statistics.mean(q['ms'] for q in samples),'lockBusy':sum(q['lockBusy'] for q in samples),'samples':samples}
(base/'physical.json').write_text(json.dumps(out,indent=2))
for stage in ['10pct','50pct','full']:
 print(stage)
 for name in names:
  print(name,[(c,round(out[f'trace-{c}-{stage}'][name]['misses'],1),round(out[f'trace-{c}-{stage}'][name]['pread'],1)) for c in ['small','default','16m','256m','mmap','both']])
