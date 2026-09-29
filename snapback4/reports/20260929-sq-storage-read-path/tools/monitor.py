"""Observe only the recorded server PID; no signal or state change."""
import pathlib,sys,time,json,os
pid=int(sys.argv[1]);out=pathlib.Path(sys.argv[2]);db=pathlib.Path(sys.argv[3])
with out.open('w') as f:
 while pathlib.Path(f'/proc/{pid}').exists():
  try:
   stat=pathlib.Path(f'/proc/{pid}/stat').read_text().split();status=pathlib.Path(f'/proc/{pid}/status').read_text().splitlines()
   row={'at':time.time(),'load':os.getloadavg(),'utime':int(stat[13]),'stime':int(stat[14]),'threads':int(stat[19]),'rssPages':int(stat[23]),'walBytes':pathlib.Path(str(db)+'-wal').stat().st_size,'fds':len(list(pathlib.Path(f'/proc/{pid}/fd').iterdir())),'status':{s.split(':')[0]:s.split(':',1)[1].strip() for s in status if s.startswith(('voluntary_ctxt_switches:','nonvoluntary_ctxt_switches:'))}}
   f.write(json.dumps(row)+'\n');f.flush();time.sleep(1)
  except (OSError,IndexError):break
