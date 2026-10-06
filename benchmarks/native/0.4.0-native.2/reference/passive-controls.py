#!/usr/bin/env python3
"""Live, qualification-only controls for passive observation and row recycling."""
import argparse
import base64
import json
import shutil
import sys
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'driver'))
from evidence import PROTOCOL,body_hash,nodes,rendered_rows_valid
from run import Driver,Failure,command

PASSIVE_CONTROLS={'journal-failure','journal-overflow','recycling','stalled-writer'}
BROKEN_JOURNAL_FLUSH_REJECTIONS={
    'journal-failure':'native-writer-flush-ack-unpersisted',
    'journal-overflow':'native-writer-flush-process-mismatch',
}

def require(value,reason):
    if not value:raise Failure(reason,'instrument')

def raw(d,op,**arguments):
    d.actions+=1
    return d.bridge.send(op,**arguments)

def raw_tree(d,name,pixels=True):
    result=raw(d,'tree',screenshot=pixels);tree=result['tree']
    d.write(name+'.json',tree)
    if pixels:(d.out/(name+'.png')).write_bytes(base64.b64decode(result['png']))
    d.host('native-snapshot',file=name+'.json',screenshot=name+'.png' if pixels else None)
    return tree

def raw_tap(d,identity,value=None):
    selector={'id':identity}
    if value is not None:selector['value']=value
    return raw(d,'tap',selector=selector)

def raw_type(d,identity,value):
    return raw(d,'type',selector={'id':identity},text=value)

def raw_launch(d,phase,extra_args=()):
    attempted=time.time();number=len(d.launch_attempts)+1
    attempt={'attempt':number,'phase':phase,'attemptedAt':attempted,'completedAt':None,
      'state':'unknown','stateRaw':0,'running':False,'error':None}
    d.launch_attempts.append(attempt);d.next_launch={'at':attempted,'attempt':number}
    d.host('app-launch-attempt',attempt=number,phase=phase,bundleId=d.c['bundleId'])
    try:
        result=raw(d,'launch',args=['--clique-run',d.run_id,*extra_args]);state=d.state_info(result.get('state'),'xctest')
    except Exception as error:
        state=d.app_state();attempt.update(completedAt=time.time(),state=state['state'],stateRaw=state['stateRaw'],running=state['running'],error=str(error))
        d.host('app-launch-result',attempt=number,phase=phase,**state,error=str(error));raise
    attempt.update(completedAt=time.time(),state=state['state'],stateRaw=state['stateRaw'],running=state['running'])
    d.host('app-launch-result',attempt=number,phase=phase,**state,error=None)
    require(state['running'],'app-not-running-after-launch')

def flush_for_termination(d,reason,expected_rejection=None):
    rejection=None
    try:d.flush_observations(reason)
    except Failure as error:
        require(error.reason==expected_rejection,'unexpected-flush-rejection:'+error.reason)
        rejection={'reason':error.reason,'outcomeClass':error.kind}
    if expected_rejection is not None:require(rejection is not None,'expected-flush-rejection-missing')
    return rejection

def raw_terminate(d,reason='control-restart',expected_rejection=None):
    rejection=flush_for_termination(d,reason,expected_rejection)
    raw(d,'terminate')
    state=raw(d,'state').get('state')
    require(state==1,'app-process-survived')
    d.host('app-absent',state=state)
    return rejection

def wait_for(check,reason,timeout=15):
    deadline=time.monotonic()+timeout;last=None
    while time.monotonic()<deadline:
        try:
            value=check()
            if value:return value
        except Exception as error:last=error
        time.sleep(.25)
    raise Failure(reason+(':'+str(last) if last else ''),'instrument')

def row_for_body(tree,body):
    matches=[]
    for bubble in nodes(tree,'sm-convo-bubble'):
        if any(child.get('label')==body for child in nodes(bubble)):
            matches.append(bubble)
    require(len(matches)==1,'visible-body-count:'+body)
    return matches[0]

def oracle(d,name,bodies):
    request={'protocol':PROTOCOL,'runId':d.run_id,'conversationId':d.f['conversationId'],
      'queuedBodies':bodies,'origin':d.f['origin']}
    value=json.loads(command(d.c['oracleArgv'],input=json.dumps(request).encode(),cwd=d.c['backendCwd']))
    d.write(name+'.json',value);d.host('oracle-sample',file=name+'.json')
    require(value.get('principal')==d.f['bob'],'oracle-principal')
    require(value.get('conversationId')==d.f['conversationId'] and value.get('complete') is True,'oracle-scope')
    for body in bodies:require(sum(row.get('body')==body for row in value.get('rows',[]))==1,'server-occurrence-count:'+body)
    return value

def navigate_conversation(d):
    wait_for(lambda:raw_tap(d,'sm-nav-chats') or True,'chats-navigation')
    wait_for(lambda:raw_tap(d,'sm-chats-item',d.f['chatValue']) or True,'conversation-navigation')

def send_and_prove(d,body,prefix):
    raw_type(d,'sm-convo-input',body);raw_tap(d,'sm-convo-send')
    tree=wait_for(lambda:raw_tree(d,prefix+'-sent',True) if row_for_body(raw_tree(d,prefix+'-poll',False),body) else None,'product-send-ui')
    identity=row_for_body(tree,body).get('value');require(isinstance(identity,str) and identity,'product-send-identity')
    value=wait_for(lambda:oracle(d,prefix+'-server', [body]),'product-send-server',30)
    server=next(row for row in value['rows'] if row.get('body')==body)
    require(server.get('messageId')==identity,'product-server-identity')
    return identity

def prove_restart(d,body,identity,prefix,expected_flush_rejection):
    flush_rejection=raw_terminate(d,prefix+'-restart',expected_flush_rejection);raw_launch(d,'restart');navigate_conversation(d)
    def visible():
        for direction in ['down','up']:
            tree=raw_tree(d,prefix+'-restart-poll',False)
            try:return row_for_body(tree,body)
            except Failure:raw(d,'scroll',direction=direction)
        return None
    row=wait_for(visible,'product-persistence-ui',20)
    require(row.get('value')==identity,'product-persistence-identity')
    raw_tree(d,prefix+'-restart',True)
    value=oracle(d,prefix+'-restart-server',[body]);server=next(row for row in value['rows'] if row.get('body')==body)
    require(server.get('messageId')==identity,'product-persistence-server-identity')
    return flush_rejection

def journal_control(d,control):
    directory=d.data/'Documents/clique-native'/d.run_id
    journal=directory/'native-observations.jsonl';marker=directory/'observer-diagnostics.json';overflow=directory/'overflow.json'
    body=d.run_id+(':passive-io' if control=='journal-failure' else ':passive-overflow')
    if control=='journal-failure':
        time.sleep(.5)
        if journal.is_dir():shutil.rmtree(journal)
        elif journal.exists():journal.unlink()
        journal.mkdir()
    else:
        raw_terminate(d)
        if journal.is_dir():shutil.rmtree(journal)
        journal.write_bytes(b'{}\n'*10001)
        raw_launch(d,'restart');navigate_conversation(d)
    identity=send_and_prove(d,body,control)
    expected=marker if control=='journal-failure' else overflow
    wait_for(lambda:expected.is_file(),'passive-diagnostic-marker',10)
    expected_reason='observer-diagnostic:observation-journal-io' if control=='journal-failure' else 'observation-journal-overflow'
    expected_flush_rejection=BROKEN_JOURNAL_FLUSH_REJECTIONS[control]
    flush_rejection=prove_restart(d,body,identity,control,expected_flush_rejection)
    rejected=None
    try:d.collect()
    except Failure as error:rejected={'reason':error.reason,'outcomeClass':error.kind}
    require(rejected=={'reason':expected_reason,'outcomeClass':'instrument'},'driver-passive-rejection')
    return {'body':body,'messageId':identity,'uiSurvived':True,'serverPersisted':True,'restartPersisted':True,
      'marker':expected.name,'terminationFlushRejection':flush_rejection,'driverRejection':rejected}

def latest_screen(d):
    screens=[event for event in d.events if event.get('kind')=='screen' and event.get('payload',{}).get('route')=='conversation']
    require(bool(screens),'committed-screen-event-missing')
    return screens[-1]

def recycling_control(d):
    samples=[]
    for index,direction in enumerate(['down','down','up','up']):
        d.ui('scroll',direction=direction)
        tree=d.tree('recycling-'+str(index+1),True)
        def bind():
            d.collect();screen=latest_screen(d);observed,native=rendered_rows_valid(tree,screen)
            return {'observed':observed,'native':native,'sequence':screen['sequence']}
        sample=wait_for(bind,'recycling-projection',10);samples.append(sample)
    sets={tuple(sample['native']) for sample in samples}
    require(len(sets)>=2,'recycling-did-not-change-native-window')
    current=latest_screen(d);stale=json.loads(json.dumps(current))
    candidates=[identity for sample in samples[:-1] for identity in sample['native'] if identity not in samples[-1]['native']]
    require(bool(candidates),'recycling-stale-row-unavailable')
    stale['payload']['rows'].append({'messageId':candidates[0],'bodyHash':body_hash('removed-or-recycled'),'receipt':'sent'})
    reason=None
    try:rendered_rows_valid(json.loads((d.out/'recycling-4.json').read_text()),stale)
    except ValueError as error:reason=str(error)
    require(reason=='screen-row-detached','recycling-negative-not-rejected')
    d.write('recycling-negative.json',{'retainedMessageId':candidates[0],'expectedReason':'screen-row-detached','actualReason':reason,'event':stale})
    return {'samples':samples,'windowsChanged':True,'negativeReason':reason,'retainedMessageId':candidates[0]}

def stalled_writer_control(d):
    raw_terminate(d,'stalled-writer-control-relaunch');raw_launch(d,'stalled-writer',['--clique-stall-writer']);navigate_conversation(d)
    body=d.run_id+':stalled-writer'
    identity=send_and_prove(d,body,'stalled-writer')
    rejection=None
    try:d.flush_observations('stalled-writer-control')
    except Failure as error:rejection={'reason':error.reason,'outcomeClass':error.kind}
    require(rejection=={'reason':'native-writer-flush-timeout','outcomeClass':'instrument'},'stalled-writer-not-refused')
    return {'body':body,'messageId':identity,'uiSurvived':True,'serverPersisted':True,
      'driverRejection':rejection,'observationCallsAwaited':False}

def execute(config,segment,out,control):
    require(segment=='m6','passive-controls-require-m6')
    d=Driver(config,segment,out);started=time.time();result=None;error=None
    try:
        d.preflight();d.start_recording()
        if control in {'journal-failure','journal-overflow'}:result=journal_control(d,control)
        elif control=='recycling':result=recycling_control(d)
        else:result=stalled_writer_control(d)
    except Exception as failure:
        error={'reason':str(failure),'outcomeClass':failure.kind if isinstance(failure,Failure) else 'instrument'}
    finally:
        if d.video and d.simctl_path:
            try:
                state=d.app_state()
                if state['running'] and control not in {'stalled-writer','journal-failure'}:
                    expected=BROKEN_JOURNAL_FLUSH_REJECTIONS.get(control)
                    flush_for_termination(d,'recording-terminal-transition',expected)
                    d.sim('terminate',d.c['udid'],d.c['bundleId']);time.sleep(.2)
                    d.host('recording-terminal-transition')
                elif state['running']:
                    d.host('recording-terminal-transition-omitted',reason='native-writer-flush-unavailable')
                elif state['state']!='not-running':
                    raise Failure('terminal-app-state-unavailable','instrument')
            except Exception as failure:
                error=error or {'reason':'recording-end:'+str(failure),'outcomeClass':'instrument'}
        d.stop_owned(d.video,'recorder',True);d.stop_owned(d.log,'process-log',True);d.stop_startup_capture()
        startup=None;video=None
        for name,key in [('startup-ios-screen.mp4','startupVideo'),(segment+'-ios-screen.mp4','video')]:
            path=out/name
            if not path.is_file():continue
            try:value=json.loads(command(config['videoCheckArgv']+[str(path)],env=d.tool_env))
            except Exception as failure:
                error=error or {'reason':'invalid-'+key+':'+str(failure),'outcomeClass':'instrument'};value=None
            if key=='startupVideo':startup=value
            else:video=value
        d.cleanup()
        receipt={'version':'clique-native-passive-controls/1','control':control,'runId':d.run_id,
          'startedAt':started,'completedAt':time.time(),'pass':error is None,'failure':error,'result':result,
          'launchAttempts':d.launch_attempts,'startupVideo':startup,'video':video,
          'appleTools':{'developerDir':d.developer_dir,'xcodebuild':d.xcodebuild_path,'simctl':d.simctl_path},
          'simulatorUdid':config['udid'],'nativeCommands':d.actions}
        d.write('passive-control.json',receipt);print(json.dumps(receipt),flush=True)
    return 0 if error is None else 1

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);parser.add_argument('--segment',choices=['m6'],required=True)
    parser.add_argument('--out',required=True);parser.add_argument('--control',choices=sorted(PASSIVE_CONTROLS),required=True);args=parser.parse_args()
    config=json.loads(Path(args.config).read_text());return execute(config,args.segment,Path(args.out).resolve(),args.control)

if __name__=='__main__':sys.exit(main())
