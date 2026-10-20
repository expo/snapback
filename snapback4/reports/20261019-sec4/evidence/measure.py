"""Read-only evidence input; all project scratch is automatically removed."""
import argparse, json, pathlib, subprocess, tempfile, time, statistics, os, signal, hashlib
from concurrent.futures import ThreadPoolExecutor, as_completed
p=argparse.ArgumentParser();p.add_argument("binary");p.add_argument("output");p.add_argument("--waves",default="18");p.add_argument("--verb",default="check");p.add_argument("--jobs",type=int,default=1);p.add_argument("--lanes",default="");p.add_argument("--intent-corrections",action="store_true");a=p.parse_args()
results=[]
def measure(wave,lane):
  with tempfile.TemporaryDirectory(prefix="sec4-survey-") as scratch:
   root=pathlib.Path(scratch);(root/"snapback").mkdir();(root/"tmp").mkdir()
   for source in lane.joinpath("snapback").glob("*.q"):
    text=source.read_text()
    if a.intent_corrections and wave=="18" and lane.name.startswith("025-"):
     text=text.replace("invariant repairs.read only ","invariant repairs.read only viewer = 'service:operator' or ")
    if a.intent_corrections and wave=="18" and lane.name.startswith("045-"):
     text=text.replace("invariant signups.read only ","invariant signups.member read only ")
     text+="\ninvariant signups.home read only .member = viewer or .home = viewer or exists roles[viewer, role = 'commander'] or exists roles[viewer, role = 'scheduler']\n"
    if a.intent_corrections and wave=="18" and lane.name.startswith("026-"):
     corrected=[]
     for line in text.splitlines():
      if line.startswith("invariant buildings.read only "):
       line="invariant buildings.read only (.manager = viewer and exists roles[viewer, role = 'building_manager']) or (exists routes[technician = viewer, building = .id] and exists roles[viewer, role = 'technician']) or exists roles[viewer, role = 'dispatcher'] or exists roles[viewer, role = 'service_manager']"
      elif line.startswith("invariant units.read only "):
       line="invariant units.read only (.building.manager = viewer and exists roles[viewer, role = 'building_manager']) or (exists routes[technician = viewer, building = .building] and exists roles[viewer, role = 'technician']) or exists roles[viewer, role = 'dispatcher'] or exists roles[viewer, role = 'service_manager']"
      elif line.startswith("invariant inspections.read only "):
       line="invariant inspections.read only (.unit.building.manager = viewer and exists roles[viewer, role = 'building_manager']) or (exists routes[technician = viewer, building = .unit.building] and exists roles[viewer, role = 'technician']) or exists roles[viewer, role = 'dispatcher'] or exists roles[viewer, role = 'service_manager']"
      corrected.append(line)
     text="\n".join(corrected)+"\n"
    if a.intent_corrections and wave=="18" and lane.name.startswith("010-"):
     text=text.replace("invariant tickets.price write only ","invariant tickets.price update only ")
    if a.intent_corrections and wave=="18" and lane.name.startswith("011-"):
     lines=[]
     for line in text.splitlines():
      if line.startswith("invariant grades.read only "):
       predicate=line.split(" only ",1)[1]
       lines.extend(f"invariant grades.{column} read only {predicate}" for column in ["color","clarity","cut","comment","grader","at"])
      else:lines.append(line)
     text="\n".join(lines)+"\n"
    (root/"snapback"/source.name).write_text(text)
   (root/"package.json").write_text('{"name":"sec4-survey","private":true}')
   start=time.monotonic()
   try:
    r=subprocess.Popen([a.binary,a.verb,"--json"] if a.verb=="check" else [a.binary,a.verb],cwd=root,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=dict(os.environ,TMPDIR=str(root/"tmp")),start_new_session=True)
    stdout,stderr=r.communicate(timeout=300)
    row={"wave":wave,"lane":lane.name,"seconds":round(time.monotonic()-start,3),"exit":r.returncode,"stdout":stdout,"stderr":stderr}
   except subprocess.TimeoutExpired:
    os.killpg(r.pid,signal.SIGTERM)
    try:r.communicate(timeout=5)
    except subprocess.TimeoutExpired:os.killpg(r.pid,signal.SIGKILL);r.communicate()
    row={"wave":wave,"lane":lane.name,"seconds":300,"exit":"timeout"}
   row["sourceSha256"]={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in lane.joinpath("snapback").glob("*.q")}
   row["executedSha256"]={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in root.joinpath("snapback").glob("*.q")}
   return row
lanes=[(wave,lane) for wave in a.waves.split(",") for lane in sorted(pathlib.Path.home().joinpath("sb4-loop",f"wave{wave}","apps").glob("*" if wave=="15" else "*-snapback-*")) if list(lane.joinpath("snapback").glob("*.q")) and (not a.lanes or lane.name.split("-")[0] in a.lanes.split(","))]
with ThreadPoolExecutor(max_workers=a.jobs) as pool:
 for task in as_completed([pool.submit(measure,wave,lane) for wave,lane in lanes]):
  row=task.result();results.append(row);results.sort(key=lambda r:(int(r["wave"]),r["lane"]));pathlib.Path(a.output).write_text(json.dumps(results,indent=2)+"\n");print(row["wave"],row["lane"],row["exit"],row["seconds"],flush=True)
print("median",statistics.median(r["seconds"] for r in results),flush=True)
