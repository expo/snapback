#!/usr/bin/env python3
"""clique-native/1: instrument-owned orchestration, never a calibration launcher."""
import argparse
import base64
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import plistlib
import queue
import re
import gzip
import signal
import socket
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
from evidence import *
from video_timing import presentation_timing

HERE=Path(__file__).resolve().parent
FLUSH_PROTOCOL='clique-native-flush/1'
FLUSH_TIMEOUT_SECONDS=10
class Failure(Exception):
    def __init__(self, reason, kind='application'): self.reason=reason; self.kind=kind; super().__init__(reason)

def command(argv, **kw):
    p=subprocess.run(argv, capture_output=True, timeout=kw.pop('timeout',30), **kw)
    if p.returncode: raise Failure('command-exit:'+str(p.returncode)+':'+str(argv[0]),'setup')
    return p.stdout

# @ref LLP 0201.000#4 — every driver termination follows a bounded native journal barrier.
def flush_observation_writer(directory,run_id,expected_process_nonce=None,timeout=FLUSH_TIMEOUT_SECONDS):
    """Place a driver-only barrier behind all accepted native writer work."""
    directory=Path(directory);request_path=directory/'flush-request.json';ack_path=directory/'flush-ack.json'
    if not directory.is_dir():raise ValueError('native-writer-flush-directory-missing')
    nonce=str(uuid.uuid4());request={'protocol':FLUSH_PROTOCOL,'runId':run_id,'nonce':nonce}
    ack_path.unlink(missing_ok=True)
    temporary=directory/('.flush-request-'+nonce+'.tmp')
    try:
        with temporary.open('x') as target:
            json.dump(request,target,separators=(',',':'));target.write('\n');target.flush();os.fsync(target.fileno())
        os.replace(temporary,request_path)
    finally:
        temporary.unlink(missing_ok=True)
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        if ack_path.is_file():
            try:ack=json.loads(ack_path.read_text())
            except (OSError,json.JSONDecodeError):raise ValueError('native-writer-flush-ack-malformed') from None
            if any(ack.get(key)!=value for key,value in request.items()):
                time.sleep(.05);continue
            expected={**request,'processNonce':ack.get('processNonce'),'eventCount':ack.get('eventCount'),'byteCount':ack.get('byteCount')}
            if ack!=expected:raise ValueError('native-writer-flush-ack-mismatch')
            if not isinstance(ack['processNonce'],str) or not ack['processNonce'] or (expected_process_nonce and ack['processNonce']!=expected_process_nonce):
                raise ValueError('native-writer-flush-process-mismatch')
            if any(not isinstance(ack[key],int) or isinstance(ack[key],bool) or ack[key]<0 for key in ('eventCount','byteCount')):
                raise ValueError('native-writer-flush-ack-counts')
            journal=directory/'native-observations.jsonl'
            raw=journal.read_bytes() if journal.is_file() else b''
            prefix=raw[:ack['byteCount']]
            if len(raw)<ack['byteCount'] or len(raw.splitlines())<ack['eventCount'] or (prefix and not prefix.endswith(b'\n')) or len(prefix.splitlines())!=ack['eventCount']:
                raise ValueError('native-writer-flush-ack-unpersisted')
            if ack['eventCount']:
                try:last=json.loads(prefix.splitlines()[-1])
                except (IndexError,json.JSONDecodeError):raise ValueError('native-writer-flush-journal-malformed') from None
                if last.get('processNonce')!=ack['processNonce']:raise ValueError('native-writer-flush-process-mismatch')
            return request,ack
        time.sleep(.05)
    raise ValueError('native-writer-flush-timeout')

class Bridge:
    def __init__(self, port):
        self.commands=queue.Queue();self.results=queue.Queue();self.serial=0
        owner=self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*a): pass
            def do_GET(self):
                try: value=owner.commands.get(timeout=20)
                except queue.Empty: value={'op':'idle'}
                self.send_response(200);self.end_headers();self.wfile.write(json.dumps(value).encode())
            def do_POST(self):
                value=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                owner.results.put(value);self.send_response(200);self.end_headers();self.wfile.write(b'{}')
        self.server=ThreadingHTTPServer(('127.0.0.1',port),Handler)
        threading.Thread(target=self.server.serve_forever,daemon=True).start()
    def send(self, op, _timeout=35, **args):
        self.serial+=1;self.commands.put({'serial':self.serial,'op':op,**args})
        try: result=self.results.get(timeout=_timeout)
        except queue.Empty: raise Failure('native-runner-unavailable','instrument')
        if result.get('serial')!=self.serial: raise Failure('runner-command-sequence','instrument')
        if result.get('error'): raise Failure(result['error'])
        return result
    def close(self): self.server.shutdown();self.server.server_close()

class Driver:
    def __init__(self,c,segment,out):
        self.c=c;self.segment=segment;self.out=out;self.run_id=str(uuid.uuid4());self.started=time.time();self.clock=time.monotonic()
        self.backend=None;self.runner=None;self.video=None;self.startup_video=None;self.startup_video_stopped=False;self.log=None;self.bridge=None
        self.events=[];self.event_count=0;self.launches=[];self.next_launch=None;self.offline=[];self.cut=False
        self.launch_attempts=[];self.secondary_failures=[]
        self.steps=[];self.receipts=[];self.refs={};self.active=None;self.f=None;self.lease=None;self.video_started=None
        self.actions=0;self.prime={'complete':False};self.fail=None;self.ids=[];self.snapshot_serial=0
        self.interruption_serial=0;self.flush_serial=0
        self.developer_dir=None;self.xcodebuild_path=None;self.simctl_path=None;self.tool_env=None
        self.out.mkdir(parents=True,exist_ok=False)
        self.host_file=self.out/'host.jsonl';self.host_file.touch()
    def host(self,kind,**data):
        with self.host_file.open('a') as f:f.write(json.dumps({'at':time.time(),'kind':kind,**data})+'\n')
    def sim(self,*args):
        require(self.simctl_path,'apple-tools-not-configured')
        return command([self.simctl_path,*args],env=self.tool_env)
    def launch_owned(self,argv,name,cwd=None,env=None):
        log=(self.out/(name+'.log')).open('wb')
        p=subprocess.Popen(argv,cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True);log.close()
        self.host('process-start',role=name,pid=p.pid,pgid=p.pid,argv=argv)
        return p
    def stop_owned(self,p,role,interrupt=False):
        if not p:return
        if p.poll() is None:
            os.killpg(p.pid,signal.SIGINT if interrupt else signal.SIGTERM)
            try:p.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(p.pid,signal.SIGKILL);p.wait(timeout=5)
        self.host('process-stop',role=role,pid=p.pid,exitCode=p.returncode)
    def reachable(self):
        parsed=urlparse(self.c['origin'])
        try:
            with socket.create_connection((parsed.hostname,parsed.port),timeout=.3) as connection:
                # Darwin may allocate the destination as the ephemeral source, creating a self-connection.
                return connection.getsockname()!=connection.getpeername()
        except OSError:return False
    def probe(self):
        p={'at':time.time(),'reachable':self.reachable()};self.offline.append(p);self.host('offline-probe',**{k:v for k,v in p.items() if k!='at'})
        if p['reachable']:raise Failure('backend-reachable-during-offline','instrument')
    def start_backend(self):
        if self.reachable():raise Failure('backend-port-already-owned','setup')
        self.backend=self.launch_owned(self.c['backendArgv'],'backend',self.c['backendCwd'])
        deadline=time.monotonic()+30
        while not self.reachable():
            if self.backend.poll() is not None or time.monotonic()>deadline:raise Failure('backend-start-unavailable','setup')
            time.sleep(.1)
    def cut_backend(self):
        self.stop_owned(self.backend,'backend');require(self.backend.poll() is not None,'backend-pid-survived')
        self.cut=True
        for _ in range(3):self.probe();time.sleep(.15)
    def ui(self,op,**args):
        if self.cut:self.probe()
        self.actions+=1
        try:result=self.bridge.send(op,**args)
        except Failure as error:
            if error.reason!='selector-not-hittable' or op not in ('tap','type') or not self.dismiss_password_save_interruption(op):raise
            self.actions+=1;result=self.bridge.send(op,**args)
        self.collect()
        if self.cut:self.probe()
        return result
    def dismiss_password_save_interruption(self,failed_op):
        """Dismiss only the recognized OS password offer, then permit one retry."""
        try:
            self.actions+=1;result=self.bridge.send('tree',screenshot=True)
            tree=result['tree']
            if result.get('state')!=4 or not any(str(node.get('label','')).startswith('Save Password') for node in nodes(tree)):
                return False
            candidates=[node for node in nodes(tree) if node.get('id') and node.get('label') in ('Not Now','Never')]
            action=candidates[0]['id'] if candidates else 'Not Now'
            self.interruption_serial+=1;name='os-password-save-'+str(self.interruption_serial)
            self.write(name+'.json',tree)
            if result.get('png'):(self.out/(name+'.png')).write_bytes(base64.b64decode(result['png']))
            self.host('native-snapshot',file=name+'.json',screenshot=name+'.png' if result.get('png') else None)
            self.actions+=1;self.bridge.send('tap',selector={'id':action})
            self.host('os-interruption',interruption='password-save',action=action,failedOperation=failed_op)
            return True
        except Exception:return False
    @staticmethod
    def state_info(raw,source='xctest'):
        names={0:'unknown',1:'not-running',2:'suspended',3:'background',4:'foreground'}
        raw=raw if isinstance(raw,int) and raw in names else 0
        return {'state':names[raw],'stateRaw':raw,'running':raw in (2,3,4),'source':source}
    def host_app_state(self):
        if self.simctl_path and getattr(self,'executable',None):
            try:
                # XCUITest can relocate its application host again on first
                # launch, after runner attachment. Resolve the current app
                # container for this exact simulator and bundle before census.
                current=Path(self.sim('get_app_container',self.c['udid'],self.c['bundleId'],'app').decode().strip())
                if not current.is_absolute():return self.state_info(0,'unavailable')
                self.installed_app=current
            except Exception:
                # A failed custody lookup cannot prove process absence.
                return self.state_info(0,'unavailable')
            try:
                # Simulator applications are host processes. iOS runtimes do not
                # ship ps, so retain only exact matches to this UDID-bound
                # installed executable path.
                p=subprocess.run(['/bin/ps','-wwaxo','pid=,comm=,args='],capture_output=True,text=True,timeout=10,env=self.tool_env)
                if p.returncode==0:
                    expected=str(self.installed_app/self.executable)
                    matches=[]
                    for line in p.stdout.splitlines():
                        fields=line.strip().split(None,2)
                        if len(fields)==3 and fields[0].isdigit():
                            argv0=fields[2].split(None,1)[0]
                            if fields[1]==expected or argv0==expected:matches.append(int(fields[0]))
                    return {**self.state_info(3 if matches else 1,'host-process'),'processIds':matches}
            except Exception:
                pass
        return self.state_info(0,'unavailable')
    def app_state(self):
        if self.bridge and (self.runner is None or self.runner.poll() is None):
            try:
                self.actions+=1
                return self.state_info(self.bridge.send('state',_timeout=3).get('state'),'xctest')
            except Exception:
                pass
        return self.host_app_state()
    def launch_application(self,phase):
        attempted=time.time();number=len(self.launch_attempts)+1
        attempt={'attempt':number,'phase':phase,'attemptedAt':attempted,'completedAt':None,**self.state_info(0),'error':None}
        attempt.pop('source')
        self.launch_attempts.append(attempt);self.next_launch={'at':attempted,'attempt':number}
        self.host('app-launch-attempt',attempt=number,phase=phase,bundleId=self.c['bundleId'])
        try:
            result=self.ui('launch',args=['--clique-run',self.run_id])
            state=self.state_info(result.get('state'),'xctest')
        except Exception as e:
            state=self.app_state();attempt.update(completedAt=time.time(),state=state['state'],stateRaw=state['stateRaw'],running=state['running'],error=str(e))
            self.host('app-launch-result',attempt=number,phase=phase,**state,error=str(e))
            raise
        attempt.update(completedAt=time.time(),state=state['state'],stateRaw=state['stateRaw'],running=state['running'])
        self.host('app-launch-result',attempt=number,phase=phase,**state,error=None)
        require(state['running'],'app-not-running-after-launch')
        return attempted
    def collect(self):
        if not hasattr(self,'data'):return
        directory=self.data/'Documents/clique-native'/self.run_id
        path=directory/'native-observations.jsonl'
        if not directory.exists():
            actual=Path(self.sim('get_app_container',self.c['udid'],self.c['bundleId'],'data').decode().strip())
            if actual!=self.data:
                self.host('container-relocated',before=str(self.data),after=str(actual),primed=self.prime['complete'])
                if self.prime['complete']:raise Failure('installation-changed-after-prime','instrument')
                self.data=actual;directory=self.data/'Documents/clique-native'/self.run_id;path=directory/'native-observations.jsonl'
        diagnostic=directory/'observer-diagnostics.json'
        if diagnostic.exists():
            value=diagnostic.read_text();self.write('observer-diagnostics.json',value)
            try:reason=json.loads(value).get('reason','unknown')
            except Exception:reason='malformed'
            raise Failure('observer-diagnostic:'+str(reason),'instrument')
        overflow=directory/'overflow.json'
        if overflow.exists():
            self.write('overflow.json',overflow.read_text())
            raise Failure('observation-journal-overflow','instrument')
        if not path.exists():return
        if path.stat().st_size>4*1024*1024:raise Failure('observation-journal-overflow','instrument')
        raw=path.read_bytes()
        if raw and not raw.endswith(b'\n'):raise Failure('truncated-observation-line','instrument')
        (self.out/'native-observations-app.jsonl').write_bytes(raw)
        lines=raw.splitlines()
        if len(lines)>10000:raise Failure('observation-journal-overflow','instrument')
        if len(lines)<self.event_count:raise Failure('observation-stream-truncated','instrument')
        for line in lines[self.event_count:]:
            event=json.loads(line);event['receivedAt']=time.time()
            if event.get('processNonce') not in [l['processNonce'] for l in self.launches]:
                if self.next_launch is None:raise Failure('unrecorded-process-nonce','instrument')
                launch=self.next_launch if isinstance(self.next_launch,dict) else {'at':self.next_launch,'attempt':len(self.launch_attempts)}
                self.launches.append({'processNonce':event['processNonce'],'at':launch['at'],'launchAttempt':launch['attempt']});self.next_launch=None
            self.events.append(event)
        self.event_count=len(lines)
        self.write('native-observations.jsonl',''.join(json.dumps(e)+'\n' for e in self.events))
        if self.f and self.events:
            try:events_valid(self.events,self.f,self.launches,self.build)
            except ValueError as e:raise Failure(str(e),'instrument')
        if getattr(self,'once_guard',False) and len(self.launches)>=2:
            try:no_viewonce_reload([e for e in self.events if e['processNonce']==self.launches[-1]['processNonce']],self.f)
            except ValueError as e:
                self.once_guard=False;self.once_failure=str(e);self.receipts=[r for r in self.receipts if r['assertion']!='m6-a04'];self.refs.pop('m6-a04',None);self.begin('m6-a04')
                raise Failure(str(e)) from None
    def write(self,name,value):
        (self.out/name).write_text(value if isinstance(value,str) else json.dumps(value,indent=2)+'\n')
    def tree(self,name=None,pixels=False):
        result=self.ui('tree',screenshot=pixels)
        tree=result['tree'];self.snapshot_serial+=1
        name=name or 'tree-'+str(self.snapshot_serial)
        self.write(name+'.json',tree)
        self.host('native-snapshot',file=name+'.json',screenshot=name+'.png' if pixels else None)
        if pixels:(self.out/(name+'.png')).write_bytes(base64.b64decode(result['png']))
        return tree
    def tap(self,id,value=None,parent=None):
        selector={'id':id}
        if value is not None:selector['value']=value
        if parent:selector['parent']={'id':'sm-convo-bubble','value':parent}
        self.ui('tap',selector=selector)
    def type(self,id,text):self.ui('type',selector={'id':id},text=text)
    def wait(self,fn,timeout=10,retry_reasons=None):
        end=time.monotonic()+timeout;last=None
        while time.monotonic()<end:
            if getattr(self,'once_failure',None):raise Failure(self.once_failure)
            try:return fn()
            except (ValueError,Failure) as e:
                if getattr(self,'once_failure',None):raise Failure(self.once_failure) from None
                if isinstance(e,Failure) and e.kind!='application':raise
                if retry_reasons is not None and str(e) not in retry_reasons:raise
                last=e;time.sleep(.25)
        raise Failure(str(last) if last else 'observation-timeout')
    def locate(self,id,value=None,scroll_event=None):
        def get(tree):return [n for n in nodes(tree,id) if (value is None or n['value']==value) and (n['hittable'] or any(c['hittable'] for c in nodes(n)))]
        for direction in ['down','up']:
            for _ in range(10):
                t=self.tree();found=get(t)
                if len(found)==1:return found[0]
                if scroll_event:self.host(scroll_event,afterSequence=self.events[-1]['sequence'])
                self.ui('scroll',direction=direction)
        raise Failure('fixture-row-not-found:'+str(value))
    def navigate(self):
        self.tap('sm-nav-chats');self.wait(lambda:self.tap('sm-chats-item',self.f['chatValue']))
    def launch(self):
        self.collect()
        previous={l['processNonce'] for l in self.launches}
        launched_at=self.launch_application('cold' if self.segment=='m6' else 'restart')
        def ready():
            self.collect()
            fresh={l['processNonce'] for l in self.launches if l['processNonce'] not in previous and l['at']>=launched_at}
            require(any(e['kind']=='ready' and e['processNonce'] in fresh and e['receivedAt']>=launched_at for e in self.events),'authentication-restore')
        self.wait(ready,30)
    def flush_observations(self,reason,collect_after=True):
        directory=self.data/'Documents/clique-native'/self.run_id
        expected=self.launches[-1]['processNonce'] if self.launches else None
        try:request,ack=flush_observation_writer(directory,self.run_id,expected)
        except (OSError,ValueError) as error:raise Failure(str(error),'instrument') from None
        raw=(directory/'native-observations.jsonl').read_bytes() if (directory/'native-observations.jsonl').is_file() else b''
        (self.out/'native-observations-app.jsonl').write_bytes(raw)
        self.flush_serial+=1
        request_name='observer-flush-'+str(self.flush_serial)+'-request.json'
        ack_name='observer-flush-'+str(self.flush_serial)+'-ack.json'
        self.write(request_name,request);self.write(ack_name,ack)
        prefix=raw[:ack['byteCount']]
        self.host('observation-flush-ack',flush=self.flush_serial,reason=reason,requestFile=request_name,ackFile=ack_name,
          journalPrefixSha256=hashlib.sha256(prefix).hexdigest(),**ack)
        if collect_after:self.collect()
        return ack
    def terminate(self,reason='process-restart'):
        self.flush_observations(reason)
        self.ui('terminate');state=self.ui('state')['state'];require(state==1,'app-process-survived')
        self.host('app-absent',state=state)
    def installed(self):
        app=Path(self.sim('get_app_container',self.c['udid'],self.c['bundleId'],'app').decode().strip())
        self.installed_app=app
        info=plistlib.loads((app/'Info.plist').read_bytes())
        return {'bundleId':info['CFBundleIdentifier'],'nativeSha256':sha(app/info['CFBundleExecutable']),'hermesSha256':sha(app/'main.jsbundle')}
    def refresh_attached_installation(self):
        # XCTest may reinstall/relocate its test host while attaching. Refresh
        # the exact executable path used by host census, while proving the
        # admitted build identity did not change.
        attached=self.installed()
        require(attached==self.installed_before==self.build,'installed-build-mismatch')
    def store_identity(self):
        p=Path(self.c['dataDirectory']).resolve();s=p.stat();return {'path':str(p),'device':s.st_dev,'inode':s.st_ino}
    def step(self,n):self.steps.append({'step':n,'at':time.time()});self.host('step',number=n)
    def begin(self,id):self.active=id;self.assertion_started=time.time();self.start_event=len(self.events)
    def finish(self,files):
        self.collect();self.receipt(self.active,True,None)
        self.refs[self.active]={'files':files,'eventSequences':[[e['processNonce'],e['sequence']] for e in self.events[self.start_event:]],'videoSeconds':time.time()-self.video_started}
        # Existing committed frame events may be reused only with explicit identity references.
        if not self.refs[self.active]['eventSequences']:self.refs[self.active]['eventSequences']=[[e['processNonce'],e['sequence']] for e in self.events[-2:]]
        self.active=None
    def receipt(self,id,value,reason,kind=None):
        at=time.time();self.receipts.append({'version':VERSION,'runId':self.run_id,'recordedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(at)),
          'type':'assertion','segment':self.segment,'assertion':id,'implemented':value is not None,'required':False,
          'status':'skipped' if value is None else ('passed' if value else 'failed'),'pass':value,
          'timings':[] if value is None else [{'attempt':1,'pass':value,'startedAt':None,'durationMs':max(0,(at-getattr(self,'assertion_started',at))*1000),'settlementWaitMs':0,'metrics':{}}],
          'bestOf':1,'details':{'selection':'single-native-run','selectedAttempt':None if value is None else 1,'reason':reason},'outcomeClass':kind})
    def event(self,kind,predicate,since=0):
        self.collect();return next((e for e in reversed(self.events[since:]) if e['kind']==kind and predicate(e['payload'])),None)
    def media(self,key,name,positive=True):
        f=self.f[key];self.locate('sm-convo-bubble',f['messageId']);start=len(self.events)
        self.tap('sm-convo-viewonce' if key=='viewOnce' else 'sm-convo-media',parent=f['messageId'])
        if positive:
            self.wait(lambda:require(self.event('media',lambda p:p['messageId']==f['messageId'] and p['event']=='load',start),'media-load-missing'))
        t=self.tree(name,True);media=nodes(t,'sm-media-viewer-image')
        require(len(media)==1,'media-pixels-node-missing')
        frame={**media[0]['frame'],'screenWidth':t['frame']['width']}
        fixture=self.c['ordinaryImage'] if key=='ordinary' else self.c.get('viewOnceImage')
        if fixture:
            matched,error=pixel_match(self.out/(name+'.png'),frame,fixture)
            self.write(name+'-pixels.json',{'matched':matched,'meanAbsoluteError':error,'frame':frame,'fixtureSha256':sha(fixture)})
            require(matched,'placeholder-or-wrong-media-pixels')
        else:raise Failure('fixture-pixel-reference-missing','setup')
        self.tap('sm-media-viewer-close')
    def prime_app(self):
        self.launch_application('prime')
        self.type('sm-auth-email',os.environ['CLIQUE_ALICE_EMAIL']);self.type('sm-auth-password',os.environ['CLIQUE_ALICE_PASSWORD']);self.tap('sm-auth-submit')
        self.wait(lambda:require(self.event('ready',lambda p:p['principal']==self.f['alice']),'sign-in'),30)
        self.navigate();self.locate('sm-convo-bubble',self.f['history']['messageId']);self.tree('prime-history',True)
        self.media('ordinary','prime-ordinary');self.media('viewOnce','prime-once')
        self.wait(lambda:require(self.event('media',lambda p:p['messageId']==self.f['viewOnce']['messageId'] and p['event']=='consumed'),'prime-consumption'))
        # Independent server second-view refusal through the lane's ordinary API is part of fixture verification.
        self.prime={'complete':True,'endedAt':time.time(),'eventCount':len(self.events)}
    def start_recording(self):
        self.video_started=time.time()
        self.video=self.launch_owned([self.simctl_path,'io',self.c['udid'],'recordVideo','--codec','h264',str(self.out/(self.segment+'-ios-screen.mp4'))],'recorder',env=self.tool_env)
        time.sleep(.7);require(self.video.poll() is None,'recorder-not-alive')
    def start_startup_capture(self):
        self.log=self.launch_owned([self.simctl_path,'spawn',self.c['udid'],'log','stream','--style','json','--predicate','process == '+json.dumps(self.executable)+' AND (messageType == 16 OR messageType == 17)'],'process-log',env=self.tool_env)
        self.startup_video=self.launch_owned([self.simctl_path,'io',self.c['udid'],'recordVideo','--codec','h264',str(self.out/'startup-ios-screen.mp4')],'startup-recorder',env=self.tool_env)
        time.sleep(.7);require(self.startup_video.poll() is None,'startup-recorder-not-alive')
    def stop_startup_capture(self):
        if self.startup_video and not self.startup_video_stopped:
            self.stop_owned(self.startup_video,'startup-recorder',True);self.startup_video_stopped=True
    def compose(self,name):
        ids=[]
        for i,body in enumerate(self.f['queuedBodies']):
            self.type('sm-convo-input',body);self.tap('sm-convo-send')
            def check():
                tree=self.tree(name+'-'+str(i+1),True)
                found=pending(tree,self.f['queuedBodies'][:i+1]);self.collect()
                for b,id in zip(self.f['queuedBodies'][:i+1],found):
                    require(self.event('write',lambda p:p['messageId']==id and p['bodyHash']==body_hash(b) and p['state']=='pending'),'pending-write-event')
                    require(self.event('screen',lambda p:any(r['messageId']==id and r['bodyHash']==body_hash(b) and r['receipt']=='pending' for r in p['rows'])),'pending-render-event')
                return found
            ids=self.wait(check)
        self.ids=ids
    def oracle(self,name,receipt=None):
        inp={**{k:self.f[k] for k in ['protocol','runId','conversationId','queuedBodies']},'origin':self.f['origin']}
        raw=command(self.c['oracleArgv'],input=json.dumps(inp).encode(),cwd=self.c['backendCwd']);value=json.loads(raw)
        self.write(name+'.json',value);self.host('oracle-sample',file=name+'.json')
        oracle_valid(value,self.f,self.ids,receipt);return value
    def reconnect(self,m6):
        self.collect()
        self.start_backend()
        # Drain events emitted while the backend was starting, before closing the offline segment.
        self.collect()
        if m6:
            try:no_viewonce_reload([e for e in self.events if e['processNonce']==self.launches[-1]['processNonce']],self.f)
            except ValueError:
                self.receipts=[r for r in self.receipts if r['assertion']!='m6-a04'];self.refs.pop('m6-a04',None);self.begin('m6-a04');raise
        self.host('reconnect-start',afterSequence=self.events[-1]['sequence'])
        self.cut=False
        pending_ids=list(self.ids)
        def flushed():
            self.collect();self.ids=settled_ids(self.events,self.f,pending_ids)
            return self.oracle('server-flush')
        self.wait(flushed,60)
        # Keep every query sample through the declared delayed-duplicate window.
        samples=[];window_started=time.time()
        self.host('duplicate-window-start')
        samples.append(self.oracle('server-window-0'));first_sample=time.monotonic()
        while True:
            time.sleep(.4)
            samples.append(self.oracle('server-window-'+str(len(samples))))
            if time.monotonic()-first_sample>=5:break
        self.host('duplicate-window-end',durationSeconds=time.time()-window_started)
        self.write('server-window.json',samples)
        if m6:self.finish(['pending-2.json','server-flush.json','server-window.json']);self.begin('m6-a07')
        receipt_started=time.monotonic();self.host('receipt-window-start')
        data={**self.f,'webOrigin':self.c['webOrigin'],'uiBoundMs':10000}
        bob=json.loads(command(['node',str(HERE/'bob.mjs')],input=json.dumps(data).encode(),timeout=60))
        self.write('bob.json',bob)
        require(len(bob['screen'])==1 and bob['screen'][0]=={'conversationId':self.f['conversationId'],'principal':self.f['bob']},'bob-wrong-conversation-or-principal')
        require(all(sum(r['messageId']==id and r['body']==body for r in bob['rows'])==1 for id,body in zip(self.ids,self.f['queuedBodies'])),'bob-message-identity')
        if m6:self.begin('m6-a05')
        def read():
            t=self.tree('final-read',True);pending(t,self.f['queuedBodies'],self.ids,'read')
            read_screen_valid(self.events,self.f,self.ids,time.time())
            self.oracle('server-final','read')
            require(time.monotonic()-receipt_started<=60,'receipt-deadline-exceeded')
        self.wait(read,60)
        self.host('receipt-window-end',durationSeconds=time.monotonic()-receipt_started)
        files=['server-final.json','server-window.json','bob.json','final-read.json','final-read.png']
        if m6:
            self.finish(['pending-2.json',*files]);self.begin('m6-a07')
        self.finish(files)
    def search_destination(self):
        self.tap('sm-nav-search');self.type('sm-search-input',self.f['search']['token'])
        self.collect();start=len(self.events)
        self.host('search-result-tap',afterSequence=self.events[-1]['sequence'])
        self.wait(lambda:self.tap('sm-search-result',self.f['search']['messageId']))
        def destination():
            t=self.tree()
            containers=nodes(t,'sm-conversation')
            require(len(containers)==1 and containers[0].get('value')==self.f['conversationId'],'native-conversation-identity')
            self.locate('sm-convo-bubble',self.f['history']['messageId'],scroll_event='search-scroll')
            name='search-poll-'+str(self.snapshot_serial+1)
            t=self.tree(name,True)
            conversation_valid(t,self.events[start:],self.f,True)
            captures=[json.loads(h) for h in self.host_file.read_text().splitlines()]
            # Publish the successful capture with its original timestamp, never an earlier poll's.
            self.write('cold-search.json',t)
            (self.out/'cold-search.png').write_bytes((self.out/(name+'.png')).read_bytes())
            captures=[json.loads(h) for h in self.host_file.read_text().splitlines()]
            self.host('native-snapshot',file='cold-search.json',screenshot='cold-search.png',at=snapshot_time(captures,name+'.json'))
        self.wait(destination)
        self.finish(['cold-search.json','cold-search.png'])
    def m6(self):
        self.terminate('prime-to-measurement');self.cut_backend();self.start_recording();self.step(1)
        require(self.ui('state')['state']==1,'app-present-before-cold-launch')
        self.once_guard=True
        self.step(2);self.begin('m6-a01');self.launch();self.navigate();self.locate('sm-convo-bubble',self.f['history']['messageId'])
        def committed_history():
            t=self.tree('cold-history',True)
            current=[e for e in self.events[self.prime['eventCount']:] if e['processNonce']==self.launches[-1]['processNonce']]
            screen=conversation_valid(t,current,self.f)
            rendered_rows_valid(t,screen)
        self.wait(committed_history,retry_reasons={'conversation-screen-missing','screen-conversation','conversation-history-render','screen-row-detached'})
        self.finish(['cold-history.json','cold-history.png'])
        self.step(3);self.begin('m6-a02');self.media('ordinary','cold-ordinary');self.finish(['cold-ordinary.json','cold-ordinary.png','cold-ordinary-pixels.json'])
        self.step(4);self.begin('m6-a04');self.locate('sm-convo-bubble',self.f['viewOnce']['messageId'])
        self.collect();self.once_after_sequence=self.events[-1]['sequence']
        reopen_at=time.time();self.host('viewonce-reopen',afterSequence=self.once_after_sequence,at=reopen_at)
        attempted=self.tree('cold-once-attempt')
        once=nodes(row(attempted,self.f['viewOnce']['messageId']),'sm-convo-viewonce');require(len(once)==1,'viewonce-accessibility')
        if once[0]['enabled']:self.tap('sm-convo-viewonce',parent=self.f['viewOnce']['messageId'])
        prime_frame=viewonce_frame(json.loads((self.out/'prime-once.json').read_text()))
        def refused():
            t=self.tree('cold-once',True)
            still_visible,score=viewonce_pixels(self.out/'prime-once.png',self.out/'cold-once.png',prime_frame,self.c['viewOnceImage'])
            viewer_visible=bool(nodes(t,'sm-media-viewer-image'))
            self.write('cold-once-pixels.json',{'samePixels':still_visible,'matchScore':score,'frame':prime_frame,'viewerVisible':viewer_visible})
            # @ref LLP 0201.000#round-4--sticky-disclosure-and-scaled-pixels — the first disclosure and its capture survive polling.
            if still_visible or viewer_visible:
                self.once_failure='stale-viewonce-pixels'
                raise Failure(self.once_failure)
            viewonce_refusal(t,[e for e in self.events if e['processNonce']==self.launches[-1]['processNonce']],self.f,self.once_after_sequence)
        self.wait(refused,max(0,10-(time.time()-reopen_at)),retry_reasons={'viewonce-refusal-missing'})
        self.finish(['cold-once-attempt.json','cold-once.json','cold-once.png','cold-once-pixels.json','prime-once.json','prime-once.png','viewonce-fixture.png'])
        self.once_guard=True
        self.step(5);self.begin('m6-a03');self.search_destination()
        self.step(6);self.begin('m6-a05');self.compose('pending')
        # Receipt credit is deferred until the authoritative server and native UI read checks.
        self.active=None
        self.step(7);self.begin('m6-a06');self.reconnect(True);self.step(8)
    def m8(self):
        self.start_recording();self.step(1);self.cut_backend();self.begin('m8-a17');self.compose('warm-pending')
        self.step(2);self.terminate('pending-process-restart');self.launch();self.navigate()
        self.step(3);self.locate('sm-convo-bubble',self.ids[-1])
        def restored():
            pending(self.tree('restart-pending',True),self.f['queuedBodies'],self.ids)
            pending_screen_valid([e for e in self.events if e['processNonce']==self.launches[-1]['processNonce']],self.f,self.ids,time.time())
        self.wait(restored)
        self.finish(['warm-pending-2.json','restart-pending.json','restart-pending.png'])
        self.step(4);self.begin('m8-a18');self.reconnect(False);self.step(5)
    def configure_apple_tools(self):
        self.developer_dir=self.c.get('developerDir') or os.environ.get('DEVELOPER_DIR')
        if not self.developer_dir:raise Failure('pinned-developer-dir-required','setup')
        developer=Path(self.developer_dir).resolve()
        if not developer.is_dir():raise Failure('pinned-developer-dir-invalid','setup')
        self.developer_dir=str(developer);self.tool_env=os.environ.copy();self.tool_env['DEVELOPER_DIR']=self.developer_dir
        pinned_path=str(developer/'usr/bin')+os.pathsep+self.tool_env.get('PATH','')
        self.tool_env['PATH']=pinned_path
        # xcodebuild strips TEST_RUNNER_ and forwards these to XCTest. This keeps
        # its failure-diagnostic xcrun calls on the same disclosed Xcode.
        self.tool_env['TEST_RUNNER_DEVELOPER_DIR']=self.developer_dir
        self.tool_env['TEST_RUNNER_PATH']=pinned_path
        xcrun='/usr/bin/xcrun'
        self.xcodebuild_path=command([xcrun,'--find','xcodebuild'],env=self.tool_env).decode().strip()
        self.simctl_path=command([xcrun,'--find','simctl'],env=self.tool_env).decode().strip()
        require(Path(self.xcodebuild_path).is_file() and Path(self.simctl_path).is_file(),'pinned-apple-tool-missing')
    def preflight(self):
        if sys.platform!='darwin':raise Failure('unavailable-host:macOS-required','setup')
        self.configure_apple_tools()
        native_root=HERE.parent
        instrument=json.loads((native_root/'instrument.manifest.json').read_text())
        identity=self.c.get('instrument',{})
        require(identity.get('commit')==(native_root/'INSTRUMENT_COMMIT').read_text().strip(),'instrument-commit-mismatch')
        require(identity.get('inventorySha256')==instrument['inventorySha256']==sha(native_root/'INSTRUMENT.sha256'),'instrument-inventory-mismatch')
        require(identity.get('instrumentPin')==instrument['instrumentPin'] and identity.get('scoredUse') is False,'instrument-pin-or-admission')
        for name,digest in instrument['files'].items():require(sha(safe_file(native_root,name))==digest,'instrument-source-drift:'+name)
        if self.c['udid']=='booted':raise Failure('explicit-simulator-required','setup')
        devices=json.loads(self.sim('list','devices','available','--json'))['devices']
        selected=[(runtime,d) for runtime,ds in devices.items() for d in ds if d['udid']==self.c['udid']]
        if len(selected)!=1:raise Failure('unavailable-simulator','setup')
        runtime,device=selected[0]
        if device['state']!='Booted':raise Failure('unavailable-simulator:not-booted','setup')
        self.runtime=runtime;self.xcode=command([self.xcodebuild_path,'-version'],env=self.tool_env).decode().strip()
        self.lease=open('/tmp/clique-native-'+self.c['udid']+'.lock','a')
        try:fcntl.flock(self.lease,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise Failure('unavailable-simulator:leased','setup')
        if self.reachable():raise Failure('origin-port-occupied','setup')
        source=Path(self.c['app']);info=plistlib.loads((source/'Info.plist').read_bytes())
        require(info['CFBundleIdentifier']==self.c['bundleId'],'bundle-identity')
        self.executable=info['CFBundleExecutable']
        require((source/'main.jsbundle').read_bytes()[:8]==bytes.fromhex('c61fbc03c103191f'),'release-hermes-bytecode-required')
        self.build={'bundleId':info['CFBundleIdentifier'],'nativeSha256':sha(source/info['CFBundleExecutable']),'hermesSha256':sha(source/'main.jsbundle')}
        # Installation is outside prime/measurement; refuse replacing an existing app.
        existing=subprocess.run([self.simctl_path,'get_app_container',self.c['udid'],self.c['bundleId'],'app'],capture_output=True,env=self.tool_env)
        if existing.returncode==0:raise Failure('app-installation-already-present','setup')
        self.sim('install',self.c['udid'],self.c['app']);self.installed_before=self.installed();require(self.installed_before==self.build,'installed-build-mismatch')
        self.data=Path(self.sim('get_app_container',self.c['udid'],self.c['bundleId'],'data').decode().strip())
        self.bridge=Bridge(49492)
        runner_argv=list(self.c['runnerArgv'])
        if Path(runner_argv[0]).name=='xcodebuild':runner_argv[0]=self.xcodebuild_path
        self.runner=self.launch_owned(runner_argv,'xctest',self.c.get('runnerCwd'),self.tool_env)
        self.ui('attach',bundleId=self.c['bundleId'])
        self.refresh_attached_installation()
        self.data=Path(self.sim('get_app_container',self.c['udid'],self.c['bundleId'],'data').decode().strip())
        self.start_backend();self.store_before=self.store_identity()
        seed={'protocol':PROTOCOL,'runId':self.run_id,'origin':self.c['origin'],'bundleId':self.c['bundleId']}
        self.f=json.loads(command(self.c['seedArgv'],input=json.dumps(seed).encode(),cwd=self.c['backendCwd']))
        fixture_valid(self.f,self.run_id,self.c['bundleId'],self.c['origin']);require(sha(self.c['ordinaryImage'])==self.f['ordinary']['sha256'],'fixture-asset-hash')
        self.write('native-fixture.json',self.f)
        (self.out/'ordinary-fixture.png').write_bytes(Path(self.c['ordinaryImage']).read_bytes())
        require(sha(self.c['viewOnceImage'])==self.f['viewOnce']['sha256'],'fixture-viewonce-hash')
        (self.out/'viewonce-fixture.png').write_bytes(Path(self.c['viewOnceImage']).read_bytes())
        self.host('app-container',path=str(self.data))
        self.start_startup_capture();self.prime_app();self.stop_startup_capture()
    def set_failure(self,reason,kind,primary=None,**details):
        value={'reason':reason,'outcomeClass':kind,**details}
        if primary and primary!=reason:value['primaryReason']=primary
        if self.fail is None:
            self.fail=value;return
        secondary={'reason':reason,'outcomeClass':kind,**details};self.secondary_failures.append(secondary)
        self.fail['secondaryFailures']=list(self.secondary_failures)
        if self.fail['outcomeClass']=='application' and kind=='instrument':
            original=self.fail
            self.fail={**value,'primaryReason':original.get('primaryReason',original['reason']),
              'secondaryFailures':[{'reason':original['reason'],'outcomeClass':original['outcomeClass']},*self.secondary_failures[:-1]]}
    def startup_diagnostics(self,state):
        if not self.simctl_path or not self.launch_attempts:return None
        started=self.launch_attempts[0]['attemptedAt']
        stamp=datetime.fromtimestamp(started,timezone.utc).strftime('%Y-%m-%d %H:%M:%S%z')
        executable_path=str(getattr(self,'installed_app',Path('/unavailable'))/self.executable)
        predicate='processImagePath == '+json.dumps(executable_path)
        argv=[self.simctl_path,'spawn',self.c['udid'],'log','show','--style','json','--start',stamp,'--predicate',predicate]
        try:p=subprocess.run(argv,capture_output=True,text=True,timeout=20,env=self.tool_env)
        except Exception as e:p=None;error=str(e)
        else:error=None
        text_value=((p.stdout+'\n'+p.stderr) if p else '')[-1024*1024:]
        if text_value:self.write('startup-process-log.jsonl',text_value)
        pids=sorted({int(x) for x in re.findall(r'"processID"\s*:\s*(\d+)',text_value)})
        reports=[];report_root=Path.home()/'Library/Logs/DiagnosticReports'
        if report_root.is_dir():
            candidates=sorted((x for x in report_root.iterdir() if x.is_file() and x.stat().st_mtime>=started-5),key=lambda x:x.stat().st_mtime,reverse=True)
            for source in candidates:
                prefix=source.read_bytes()[:1024*1024]
                if self.c['bundleId'].encode() not in prefix and executable_path.encode() not in prefix:continue
                name='startup-crash-'+str(len(reports)+1)+source.suffix;target=self.out/name;target.write_bytes(prefix)
                report_pids=sorted({int(x) for x in re.findall(rb'"pid"\s*:\s*(\d+)',prefix)})
                reports.append({'file':name,'sourceName':source.name,'modifiedAt':source.stat().st_mtime,'processIds':report_pids,'truncated':source.stat().st_size>len(prefix)})
                if len(reports)==5:break
        value={'bundleId':self.c['bundleId'],'executable':self.executable,'executablePath':executable_path,'simulatorUdid':self.c['udid'],
          'launchStartedAt':started,'state':state,'processIds':pids,'command':argv,'exitCode':p.returncode if p else None,'error':error,'crashReports':reports}
        self.write('startup-diagnostics.json',value);return value
    def capture_failure(self,e):
        kind=e.kind if isinstance(e,Failure) else ('application' if self.active else 'setup')
        if kind=='application' and not self.prime['complete']:kind='setup'
        primary=str(e);reason=primary;details={}
        if self.launch_attempts:
            # Prefer the exact installed-executable census for failure custody;
            # XCTest may retain a stale foreground state after process exit.
            host_state=self.host_app_state()
            state=host_state if host_state['state']=='not-running' else self.app_state()
            details['appState']=state;self.host('failure-state',**state)
            if not self.prime['complete'] and state['state']=='not-running':
                reason='app-exited-during-startup';kind='setup'
            if state['state']=='foreground':
                try:self.tree('failure',True)
                except Exception as snapshot_error:details['snapshotError']=str(snapshot_error)
            else:
                diagnostic=self.startup_diagnostics(state)
                if diagnostic is not None:details['startupDiagnostics']='startup-diagnostics.json'
        self.set_failure(reason,kind,primary=primary,**details);self.host('failure',**self.fail)
        if self.active:self.receipt(self.active,False if kind=='application' else None,self.fail['reason'],kind)
    def run(self):
        try:
            self.preflight()
            if self.segment=='m6':self.m6()
            else:self.m8()
        except Exception as e:
            self.capture_failure(e)
        finally:
            self.collect_final()
            if self.video and self.bridge:
                # Assertions and their snapshots are finished. A visible terminal
                # transition gives simctl a final sample after a static UI wait.
                try:
                    self.host('measurement-end');self.actions+=1
                    # XCTest waits for the home animation to become idle, which
                    # leaves an unrecorded static tail. Stop during that animation.
                    state=self.app_state()
                    if state['running']:
                        # Retain the barrier before interpreting newly persisted
                        # observations. A drained disclosure is an application
                        # failure, but the acknowledged process can still be
                        # terminated without losing writer work.
                        self.flush_observations('recording-terminal-transition',collect_after=False)
                        self.collect_final()
                        self.sim('terminate',self.c['udid'],self.c['bundleId']);time.sleep(.2)
                        self.host('recording-terminal-transition')
                    elif state['state']!='not-running':raise Failure('terminal-app-state-unavailable','instrument')
                except Exception as e:self.set_failure('recording-end:'+str(e),'instrument')
            # Drain the sealed process journal: callbacks buffered just before exit
            # are still part of the cold process, even after the final UI snapshot.
            self.collect_final()
            self.stop_owned(self.video,'recorder',True);self.stop_owned(self.log,'process-log',True)
            self.stop_startup_capture()
        return self.finalize()
    def collect_final(self):
        try:self.collect()
        except Exception as e:
            kind='application' if isinstance(e,Failure) and e.kind=='application' and getattr(self,'once_failure',None)==str(e) else 'instrument'
            self.set_failure(str(e),kind)
            if kind=='application':self.receipt('m6-a04',False,str(e),kind)
    def decoded_capture(self,path,require_endpoints=True):
        """Bind the configured decoder result to retained presentation timing."""
        info=json.loads(command(self.c['videoCheckArgv']+[str(path)],env=self.tool_env))
        # The qualification decoder is fault-injectable and may replace the
        # capture. Parse timing only after it returns so both checks bind the
        # same retained bytes.
        seconds,samples=presentation_timing(path,require_endpoints=require_endpoints)
        duration=info.get('durationSeconds');frames=info.get('decodedFrames')
        require(info.get('codec')=='h264' and isinstance(duration,(int,float)) and not isinstance(duration,bool) and math.isfinite(duration) and duration>0,'invalid-video')
        require(isinstance(frames,int) and not isinstance(frames,bool) and frames==samples,'video-decoded-sample-count-mismatch')
        require(abs(duration-seconds)<=.01,'invalid-video-timing')
        # The raw decoder deliberately has no endpoint authority. This value is
        # created only after presentation_timing has accepted or waived it.
        return {'codec':'h264','durationSeconds':duration,'decodedFrames':frames,'decodedEndpoints':bool(require_endpoints)}
    def finalize(self):
        present={r['assertion'] for r in self.receipts}
        for id in ASSERTIONS[self.segment]:
            if id not in present:self.receipt(id,None,'blocked:'+str(self.fail),'setup' if not self.prime['complete'] else 'application')
        self.receipts.sort(key=lambda r:ASSERTIONS[self.segment].index(r['assertion']))
        video_info=None;startup_video_info=None
        if self.video:
            try:video_info=self.decoded_capture(self.out/(self.segment+'-ios-screen.mp4'))
            except Exception as e:self.set_failure('invalid-video:'+str(e),'instrument')
        if self.startup_video and self.launch_attempts:
            path=self.out/'startup-ios-screen.mp4'
            try:startup_video_info=self.decoded_capture(path)
            except Exception as e:
                startup_video_info={'requestedCodec':'h264','captureRetained':path.is_file() and path.stat().st_size>0,
                  'validationError':str(e),'decodedEndpoints':False}
                try:startup_video_info.update(self.decoded_capture(path,require_endpoints=False))
                except Exception:pass
                self.set_failure('invalid-startup-video:'+str(e),'instrument')
        installed_after=None;store_after=None
        if hasattr(self,'data'):
            try:installed_after=self.installed();store_after=self.store_identity()
            except Exception as e:self.set_failure('final-identity:'+str(e),'instrument')
        self.cleanup()
        if self.fail and self.fail['outcomeClass']!='application':
            for r in self.receipts:
                r.update({'pass':None,'status':'skipped','implemented':False,'timings':[],'details':{'selection':'single-native-run','selectedAttempt':None,'reason':self.fail['reason']},'outcomeClass':self.fail['outcomeClass']})
        for path in self.out.glob('*.log'):
            value=path.read_text(errors='replace')
            value=re.sub(r'(?im)^.*\btype(?:text)?\s+.*$', '<redacted UI typing action>', value)
            for key in ['CLIQUE_ALICE_PASSWORD','CLIQUE_BOB_PASSWORD']:
                if os.environ.get(key): value=value.replace(os.environ[key],'<fixture-secret>')
            if path.stat().st_size>1024*1024:
                with gzip.open(str(path)+'.gz','wt') as compressed:compressed.write(value)
                path.unlink()
            else:path.write_text(value)
        manifest={'version':VERSION,'protocol':PROTOCOL,'runId':self.run_id,'segment':self.segment,'qualificationOnly':True,
          'instrument':self.c.get('instrument'),'driverSourceSha256':sha(__file__),'driverBinarySha256':self.c.get('driverBinarySha256'),
          'build':getattr(self,'build',None),'installedBefore':getattr(self,'installed_before',None),'installedAfter':installed_after,
          'simulator':{'udid':self.c['udid'],'runtime':getattr(self,'runtime',None)},
          'host':{'name':socket.gethostname(),'xcode':getattr(self,'xcode',None),'developerDir':self.developer_dir,
            'xcodebuild':self.xcodebuild_path,'simctl':self.simctl_path,
            'testRunnerDeveloperDir':self.tool_env.get('TEST_RUNNER_DEVELOPER_DIR') if self.tool_env else None,
            'testRunnerPath':self.tool_env.get('TEST_RUNNER_PATH') if self.tool_env else None},
          'backend':{'argv':self.c['backendArgv'],'origin':self.c['origin'],'cwd':self.c['backendCwd']},
          'storeBefore':getattr(self,'store_before',None),'storeAfter':store_after,'launchAttempts':self.launch_attempts,
          'observationProcesses':self.launches,'prime':self.prime,
          'steps':self.steps,'offlineProbes':self.offline,'assertionEvidence':self.refs,'video':video_info,'startupVideo':startup_video_info,'reinstalledDuringMeasurement':False,
          'failure':self.fail,'cost':{'wallSeconds':round(time.monotonic()-self.clock,3),'nativeCommands':self.actions,'enteredSteps':len(self.steps),'operatorInvocations':1},
          'files':{p.name:sha(p) for p in self.out.iterdir() if p.is_file() and p.name not in ['status.json',self.segment+'-ios-run.json']}}
        receipts_name=self.segment+'-ios-receipts.jsonl'
        def serialized():return ''.join(json.dumps(r)+'\n' for r in self.receipts)
        def bind():manifest['files'][receipts_name]=hashlib.sha256(serialized().encode()).hexdigest()
        bind()
        # Validate candidate values in memory. No durable success exists until validation returns.
        if not self.fail or self.fail['outcomeClass']=='application':
            try:verify_directory(self.out,self.segment,candidate=(manifest,serialized()))
            except Exception as e:
                self.set_failure('artifact-validation:'+str(e),'instrument')
                for r in self.receipts:
                    r.update({'pass':None,'status':'skipped','implemented':False,'timings':[],
                      'details':{'selection':'single-native-run','selectedAttempt':None,'reason':self.fail['reason']},'outcomeClass':'instrument'})
                manifest['failure']=self.fail;bind()
        self.write(receipts_name,serialized())
        self.write(self.segment+'-ios-run.json',manifest)
        value=None if self.fail and self.fail['outcomeClass']!='application' else not bool(self.fail)
        status={'id':'ios-simulator-'+self.segment,'pass':value,'receipt':self.segment+'-ios-run.json','reason':self.fail['reason'] if self.fail else None,'requiredForGreen':False,'cost':manifest['cost']}
        self.write('status.json',status)
        print(json.dumps(status),flush=True)
        return status
    def cleanup(self):
        self.cut=False
        if self.bridge:
            try:
                # XCTest can retain a foreground state after simctl has already
                # terminated the process. Prefer the exact executable census so
                # cleanup does not request an impossible second writer barrier.
                state=self.host_app_state()
                if state['state']=='unknown':state=self.app_state()
                if state['running']:
                    self.flush_observations('cleanup');self.bridge.send('terminate')
                elif state['state']!='not-running':raise Failure('cleanup-app-state-unavailable','instrument')
            except Exception as error:self.set_failure('cleanup:'+str(error),'instrument')
            try:self.bridge.send('stop')
            except Exception:pass
        if self.runner:
            try:self.runner.wait(timeout=30)
            except subprocess.TimeoutExpired:self.stop_owned(self.runner,'xctest')
        self.stop_owned(self.backend,'backend')
        if self.bridge:self.bridge.close()
        if self.lease:fcntl.flock(self.lease,fcntl.LOCK_UN);self.lease.close()
        # Post-manifest cleanup has a separate receipt: do not mutate hashed host evidence.

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);parser.add_argument('--segment',choices=['m6','m8'],required=True);parser.add_argument('--out',required=True)
    a=parser.parse_args();c=json.loads(Path(a.config).read_text());d=Driver(c,a.segment,Path(a.out).resolve());result=d.run()
    sys.exit(1 if result['pass'] is False else 0)
