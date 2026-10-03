from pathlib import Path
import time,subprocess,json,os
report=Path(__file__).resolve().parent
(report/'suite-dispatch.json').write_text(json.dumps({'pid':os.getpid(),'waitingForBothLifecycleControls':True})+'\n')
while not all((report/f'{s}-lifecycle-controls.json').exists() for s in ['plain','social']):time.sleep(5)
subprocess.run(['python3',str(report/'run-suite.py')],check=True)
