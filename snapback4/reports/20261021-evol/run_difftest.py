import argparse,json,pathlib,shutil,signal,subprocess,tempfile
p=argparse.ArgumentParser();p.add_argument('mode');p.add_argument('--cases',type=int,required=True);p.add_argument('--out',required=True);a=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[2]
signal.signal(signal.SIGTERM,lambda *_:(_ for _ in ()).throw(SystemExit(124)))
with tempfile.TemporaryDirectory(prefix='evol-difftest-',dir=root.parent) as tmp:
 cmd=[str(root/'target/debug/snapback4-difftest'),a.mode,'--seed','0','--cases',str(a.cases),'--workers','8','--out',tmp]
 r=subprocess.run(cmd,cwd=root,timeout=1000)
 report=pathlib.Path(tmp)/'report.json'
 if report.exists():shutil.copyfile(report,a.out)
 else:pathlib.Path(a.out).write_text(json.dumps({'status':'no-report','exit':r.returncode}))
 raise SystemExit(r.returncode)
