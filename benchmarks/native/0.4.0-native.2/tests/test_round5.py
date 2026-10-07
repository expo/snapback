"""Phase-2 startup regressions: valid nulls, explicit launch evidence, and state-aware capture."""
import copy,json,plistlib,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import Mock,patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'driver'))
from evidence import VERSION,launch_evidence_valid,rendered_rows_valid,schema_check,sha
from run import Driver,Failure

REGRESSIONS=json.loads((ROOT/'tests/fixtures/round7-run-regressions.json').read_text())['records']

def adapted(item):
    m=copy.deepcopy(item['record']);old=m.pop('launches')
    m['version']=VERSION;m['instrument']['instrumentPin']='social-messenger@0.4.0-native.2'
    m['host'].update(developerDir='/Applications/Xcode.app/Contents/Developer',
      xcodebuild='/Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild',
      simctl='/Applications/Xcode.app/Contents/Developer/usr/bin/simctl',
      testRunnerDeveloperDir='/Applications/Xcode.app/Contents/Developer',
      testRunnerPath='/Applications/Xcode.app/Contents/Developer/usr/bin:/usr/bin')
    if 'prior/round5' in item['source']:
        attempts=[];processes=[]
    else:
        running='snapback4/' in item['source']
        attempts=[{'attempt':1,'phase':'prime','attemptedAt':min((p['at'] for p in old),default=1)-.001,
          'completedAt':min((p['at'] for p in old),default=1),'state':'foreground' if running else 'not-running',
          'stateRaw':4 if running else 1,'running':running,'error':None}]
        processes=[{**p,'launchAttempt':1} for p in old]
    m['launchAttempts']=attempts;m['observationProcesses']=processes;m['startupVideo']=None
    return m

class Phase2RunRecords(unittest.TestCase):
    def test_exact_regression_records_have_disclosed_source_hashes(self):
        self.assertEqual(len(REGRESSIONS),6)
        self.assertTrue(all(len(item['sourceSha256'])==64 and item['record']['version']=='0.4.0-native.1' for item in REGRESSIONS))

    def test_every_real_null_record_has_a_native2_schema_representation(self):
        for item in REGRESSIONS:
            with self.subTest(source=item['source']):schema_check('run',adapted(item))

    def test_real_prelaunch_records_need_neither_launch_nor_video(self):
        for item in REGRESSIONS[:2]:
            m=adapted(item);self.assertEqual(launch_evidence_valid(m,False),([],[]))

    def test_real_postlaunch_failures_now_require_startup_video(self):
        for item in REGRESSIONS[2:]:
            with self.subTest(source=item['source']),self.assertRaisesRegex(ValueError,'startup-video-missing'):
                launch_evidence_valid(adapted(item),False)

    def test_postlaunch_unmeasured_capture_can_disclose_endpoint_validation_failure(self):
        m=adapted(REGRESSIONS[2]);m['startupVideo']={'requestedCodec':'h264','captureRetained':True,'validationError':'video-endpoint-uncovered','decodedEndpoints':False}
        schema_check('run',m);self.assertEqual(len(launch_evidence_valid(m,False)[0]),1)

    def test_measured_capture_still_requires_decoded_startup_endpoints(self):
        m=adapted(REGRESSIONS[4]);m['launchAttempts'].append({'attempt':2,'phase':'cold','attemptedAt':3,'completedAt':4,'state':'foreground','stateRaw':4,'running':True,'error':None})
        m['observationProcesses'].append({'processNonce':'00000000-0000-4000-8000-000000000002','at':3.5,'launchAttempt':2})
        m['startupVideo']={'requestedCodec':'h264','captureRetained':True,'validationError':'video-endpoint-uncovered','decodedEndpoints':False}
        with self.assertRaisesRegex(ValueError,'startup-video-missing'):launch_evidence_valid(m,True)

    def test_measured_packet_cannot_reuse_prelaunch_null_shape(self):
        with self.assertRaisesRegex(ValueError,'os-launch-evidence-missing'):
            launch_evidence_valid(adapted(REGRESSIONS[0]),True)

class StartupCapture(unittest.TestCase):
    def driver(self):
        temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup)
        d=Driver({'bundleId':'dev.clique.test','udid':'dedicated','backendArgv':['server'],'origin':'http://127.0.0.1:1','backendCwd':'/tmp'},'m6',Path(temporary.name)/'evidence')
        d.executable='TestApp';return d

    def test_prelaunch_failure_never_requests_a_snapshot(self):
        d=self.driver();d.tree=Mock(side_effect=AssertionError('snapshot must stay unused'))
        d.capture_failure(Failure('fixture-compose-nonce','setup'))
        d.tree.assert_not_called();self.assertEqual(d.fail['reason'],'fixture-compose-nonce')

    def test_exited_app_uses_state_and_keeps_primary_reason(self):
        d=self.driver();d.launch_attempts=[{'attempt':1}];d.app_state=lambda:{'state':'not-running','stateRaw':1,'running':False,'source':'host-process','processIds':[]}
        d.startup_diagnostics=lambda state:{'state':state};d.tree=Mock(side_effect=AssertionError('non-running snapshot'))
        d.capture_failure(Failure('selector-not-hittable','setup'))
        d.tree.assert_not_called();self.assertEqual(d.fail['reason'],'app-exited-during-startup')
        self.assertEqual(d.fail['primaryReason'],'selector-not-hittable');self.assertEqual(d.fail['appState']['source'],'host-process')
        self.assertEqual(d.fail['outcomeClass'],'setup')

    def test_runner_lost_during_os_launch_is_setup_when_actual_app_is_stopped(self):
        d=self.driver();d.launch_attempts=[{'attempt':1}];d.app_state=lambda:{'state':'not-running','stateRaw':1,'running':False,'source':'host-process','processIds':[]}
        d.startup_diagnostics=lambda state:{'state':state};d.tree=Mock(side_effect=AssertionError('non-running snapshot'))
        d.capture_failure(Failure('native-runner-unavailable','instrument'))
        self.assertEqual(d.fail['reason'],'app-exited-during-startup');self.assertEqual(d.fail['primaryReason'],'native-runner-unavailable')
        self.assertEqual(d.fail['outcomeClass'],'setup')

    def test_live_app_may_capture_failure_state(self):
        d=self.driver();d.launch_attempts=[{'attempt':1}];d.app_state=lambda:{'state':'foreground','stateRaw':4,'running':True,'source':'xctest'}
        d.tree=Mock(return_value={});d.capture_failure(Failure('sign-in','setup'))
        d.tree.assert_called_once_with('failure',True);self.assertEqual(d.fail['reason'],'sign-in')

    def test_host_liveness_does_not_replace_xctest_foreground_state(self):
        d=self.driver();d.launch_attempts=[{'attempt':1}]
        d.host_app_state=Mock(return_value={'state':'background','stateRaw':3,'running':True,'source':'host-process','processIds':[42]})
        d.app_state=Mock(return_value={'state':'foreground','stateRaw':4,'running':True,'source':'xctest'})
        d.tree=Mock(return_value={});d.capture_failure(Failure('sign-in','setup'))
        d.app_state.assert_called_once_with();d.tree.assert_called_once_with('failure',True)
        self.assertEqual(d.fail['appState']['source'],'xctest');self.assertEqual(d.fail['appState']['state'],'foreground')

    def test_late_observer_diagnostic_does_not_erase_setup_primary(self):
        d=self.driver();d.set_failure('sign-in','setup');d.set_failure('observer-diagnostic:journal-write','instrument')
        self.assertEqual(d.fail['reason'],'sign-in');self.assertEqual(d.fail['outcomeClass'],'setup')
        self.assertEqual(d.fail['secondaryFailures'][0]['reason'],'observer-diagnostic:journal-write')

    def test_sticky_observer_diagnostic_is_seen_without_a_journal(self):
        d=self.driver();d.data=d.out/'container';directory=d.data/'Documents/clique-native'/d.run_id
        directory.mkdir(parents=True);(directory/'observer-diagnostics.json').write_text('{"reason":"journal-write"}\n')
        with self.assertRaisesRegex(Failure,'observer-diagnostic:journal-write') as raised:d.collect()
        self.assertEqual(raised.exception.kind,'instrument');self.assertTrue((d.out/'observer-diagnostics.json').is_file())

    def test_xctest_environment_resolves_the_same_pinned_xcode(self):
        d=self.driver();d.c['developerDir']='/Applications/Xcode.app/Contents/Developer'
        answers=[b'/Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild\n',b'/Applications/Xcode.app/Contents/Developer/usr/bin/simctl\n']
        with patch('run.Path.is_dir',return_value=True),patch('run.Path.is_file',return_value=True),patch('run.command',side_effect=answers):d.configure_apple_tools()
        self.assertEqual(d.tool_env['TEST_RUNNER_DEVELOPER_DIR'],d.developer_dir)
        self.assertTrue(d.tool_env['TEST_RUNNER_PATH'].startswith(d.developer_dir+'/usr/bin:'))
        self.assertEqual(d.tool_env['PATH'],d.tool_env['TEST_RUNNER_PATH'])

    def test_process_fallback_uses_exact_installed_executable_path(self):
        d=self.driver();d.bridge=None;d.runner=None;d.simctl_path='/Applications/Xcode.app/simctl';d.tool_env={}
        d.installed_app=Path('/container/NIReference.app');d.executable='NIReference'
        d.sim=Mock(return_value=b'/container/NIReference.app\n')
        output='41 /other/NIReference /other/NIReference --flag /container/NIReference.app/NIReference\n42 /container/NIReference.app/NIReference /container/NIReference.app/NIReference --clique-run id\n'
        with patch('run.subprocess.run',return_value=Mock(returncode=0,stdout=output)) as process:
            state=d.app_state()
        self.assertEqual(state['source'],'host-process');self.assertEqual(state['processIds'],[42])
        self.assertEqual(process.call_args.args[0],['/bin/ps','-wwaxo','pid=,comm=,args='])

    def test_runner_relocation_refreshes_exact_installed_path(self):
        d=self.driver();d.simctl_path='/Applications/Xcode.app/simctl';d.tool_env={}
        with tempfile.TemporaryDirectory() as temp:
            app=Path(temp)/'Current.app';app.mkdir();(app/'TestApp').write_bytes(b'native');(app/'main.jsbundle').write_bytes(b'hermes')
            (app/'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':'dev.clique.test','CFBundleExecutable':'TestApp'}))
            build={'bundleId':'dev.clique.test','nativeSha256':sha(app/'TestApp'),'hermesSha256':sha(app/'main.jsbundle')}
            d.build=build;d.installed_before=build;d.installed_app=Path(temp)/'Relocated-Away.app'
            d.sim=Mock(return_value=(str(app)+'\n').encode());d.refresh_attached_installation()
            output=f'42 {app}/TestApp {app}/TestApp --clique-run id\n'
            with patch('run.subprocess.run',return_value=Mock(returncode=0,stdout=output)):state=d.host_app_state()
        self.assertEqual(d.installed_app,app);self.assertEqual(state['processIds'],[42])

    def test_process_census_refreshes_post_attach_relocation(self):
        d=self.driver();d.simctl_path='/Applications/Xcode.app/simctl';d.tool_env={}
        attached=Path('/container/Attached.app');launched=Path('/container/Launched.app');d.installed_app=attached
        d.sim=Mock(return_value=(str(launched)+'\n').encode())
        output=f'42 {launched}/TestApp {launched}/TestApp --clique-run id\n'
        with patch('run.subprocess.run',return_value=Mock(returncode=0,stdout=output)):state=d.host_app_state()
        self.assertEqual(d.installed_app,launched);self.assertEqual(state['processIds'],[42]);self.assertTrue(state['running'])
        d.sim.assert_called_once_with('get_app_container','dedicated','dev.clique.test','app')

    def test_process_census_resolution_failure_is_unknown(self):
        d=self.driver();d.simctl_path='/Applications/Xcode.app/simctl';d.tool_env={};d.installed_app=Path('/stale/Test.app')
        d.sim=Mock(side_effect=Failure('container-unavailable','instrument'))
        with patch('run.subprocess.run') as process:state=d.host_app_state()
        self.assertEqual(state,{'state':'unknown','stateRaw':0,'running':False,'source':'unavailable'})
        process.assert_not_called()

    def test_recycled_row_negative_is_rejected(self):
        tree={'children':[{'id':'sm-convo-bubble','value':'visible','hittable':True,'children':[]}]}
        screen={'kind':'screen','payload':{'rows':[{'messageId':'visible'}]}}
        self.assertEqual(rendered_rows_valid(tree,screen),(['visible'],['visible']))
        screen['payload']['rows'].append({'messageId':'recycled'})
        with self.assertRaisesRegex(ValueError,'screen-row-detached'):rendered_rows_valid(tree,screen)

    def test_recognized_password_save_modal_is_retained_dismissed_and_retried_once(self):
        d=self.driver();d.cut=False;d.collect=Mock();d.bridge=Mock()
        tree={'label':'','children':[{'id':'','label':'Save Password?','children':[]}]}
        d.bridge.send.side_effect=[Failure('selector-not-hittable'),{'state':4,'tree':tree,'png':''},{'serial':3},{'serial':4}]
        self.assertEqual(d.ui('tap',selector={'id':'sm-nav-chats'}),{'serial':4})
        self.assertEqual(d.actions,4);d.collect.assert_called_once_with()
        calls=d.bridge.send.call_args_list
        self.assertEqual(calls[2].args,('tap',));self.assertEqual(calls[2].kwargs,{'selector':{'id':'Not Now'}})
        self.assertEqual(calls[3].kwargs,{'selector':{'id':'sm-nav-chats'}})
        self.assertTrue((d.out/'os-password-save-1.json').is_file())
        host=[json.loads(line) for line in d.host_file.read_text().splitlines()]
        self.assertEqual([row['interruption'] for row in host if row['kind']=='os-interruption'],['password-save'])

    def test_unrecognized_selector_failure_is_not_retried(self):
        d=self.driver();d.cut=False;d.collect=Mock();d.bridge=Mock()
        d.bridge.send.side_effect=[Failure('selector-not-hittable'),{'state':4,'tree':{'label':'App error','children':[]},'png':''}]
        with self.assertRaisesRegex(Failure,'selector-not-hittable'):d.ui('tap',selector={'id':'missing'})
        self.assertEqual(d.bridge.send.call_count,2);d.collect.assert_not_called()

if __name__=='__main__':unittest.main()
