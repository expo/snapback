#!/usr/bin/env python3
"""Round-6 controls: isolated source/dist copies; never mutate the live build."""
from pathlib import Path
import json, os, shutil, subprocess
root = Path.cwd()
package = root / 'packages/snapback4'
out = root / 'reports/20260928-rg-receipts-at-scale/round6'
control = root / 'target/rg-round6-controls'
control.mkdir(exist_ok=True)

# Keep both preceding rounds' historical evidence byte-for-byte.
previous = root / 'reports/20260928-rg-receipts-at-scale/round5'
kept = {p.relative_to(previous): p.read_bytes() for p in previous.rglob('*') if p.is_file()}
try:
    with (out/'prior-controls.log').open('w') as log:
        prior = subprocess.run(['python3',str(previous/'controls.py')],stdout=log,stderr=subprocess.STDOUT)
    archive = out/'prior-controls'
    archive.mkdir(exist_ok=True)
    for name in ['controls.json','media-gate-throws.log','observation-catch-empty.log','admission-raw-call.log','receipt-save-raw-call.log','media-flag-not-cleared.log','media-backoff-reset.log']:
        shutil.copy2(previous/name,archive/name)
    shutil.copytree(previous/'round4-controls',archive/'round4-controls',dirs_exist_ok=True)
finally:
    for name,contents in kept.items(): (previous/name).write_bytes(contents)

prior_assertions = {}
for row in json.loads((out/'prior-controls/round4-controls/controls.json').read_text()):
    log = (out/'prior-controls/round4-controls'/(row['name']+'.log')).read_text()
    prior_assertions[row['name']] = row['exit']==1 and "code: 'ERR_ASSERTION'" in log and "failureType: 'testCodeFailure'" in log
(out/'prior-controls/round4-assertions.json').write_text(json.dumps(prior_assertions,indent=2)+'\n')

cases = [
 ('post-bookkeeping-guard','local.ts','    } catch {\n      if (!quiet && (!eph || ephemeralReads.current(eph))) setLink("offline");','    } catch (error) { throw error;\n      if (!quiet && (!eph || ephemeralReads.current(eph))) setLink("offline");','8',None,'optional query bookkeeping does not reject dispatch transport'),
 ('hold-metadata-guard','pending-writes.ts','} catch { /* Keep the received refusal even when the VM discards its failed save. */ }','} catch (error) { throw error; }','131',None,'failed hold metadata retains the retryable head reason'),
 ('follow-sync-guard','local.ts','        } catch {\n          if (closed) break;\n        }','        } catch (error) { throw error; if (closed) break; }','46',None,'RG injected await failure'),
 ('changes-guard','local.ts','    } catch {\n      if (closed || !ephemeralReads.current(eph)) return false;','    } catch (error) { throw error;\n      if (closed || !ephemeralReads.current(eph)) return false;','41',None,'RG injected await failure'),
 ('probe-guard','local.ts','    } catch { setLink("offline"); }','    } catch (error) { throw error; }','38',None,'RG injected await failure'),
 ('clock-serial-guard','clock.ts','this.saving = this.saving.catch(() => {}).then(() => save(value));','this.saving = this.saving.then(() => save(value));','133',None,'clock persistence recovers after host recovery'),
 ('clock-save-cache-guard','clock.ts','if (this.lastSave === saved) this.lastSave = undefined;','/* retain the rejected cached save */','133',None,'clock persistence recovers after host recovery'),
 ('retired-result-shape','local-receipts.ts','try { publish({ state: "sent", id, seq, replayed: true }); }','try { publish({ state: "sent", id, seq }); }','audit','overlapping receipt notifications','replacement recovery preserves replayed shape without a result'),
 ('settling-marker-pruning','local-receipts.ts','...entries.map(entry => entry.id), ...settling','...entries.map(entry => entry.id)','audit','a retired settlement keeps',"observation cannot forget an active settlement's prior notification"),
 ('final-loop-sync','local.ts','    await syncUnobserved();\n  }\n  // @ref', '  }\n  // @ref', 'audit', 'final flush sync', 'the final post-loop guard must start sync'),
 ('acknowledged-observation-guard','local.ts','queued().catch(() => { retryFlush(); return undefined; })','queued()', '53',None,'optional awaited failure must not strand a healthy queued tail'),
 ('acknowledged-receipt-guard','local.ts','try { await deliverAcknowledgedReceipt(history, receiptCall, entry, success, completeWrite); } catch { retryFlush(); continue; }','await deliverAcknowledgedReceipt(history, receiptCall, entry, success, completeWrite);', '52',None,'optional awaited failure must not strand a healthy queued tail'),
 ('terminal-observation-guard','local.ts','try { await syncUnobserved(outcome.state === "sent"); } catch { retryFlush(); }','await syncUnobserved(outcome.state === "sent");','65',None,'healthy callers receive terminal outcomes under optional failure'),
 ('committed-reply-guard','local-receipts.ts','if (!durable || durable.denied) throw error;','throw error;','audit','repeating post-commit receipt-save','durable receipt-save housekeeping must not strand the queued tail'),
 ('known-receipt-save-guard','writes.ts','try { await this.keep(known); } catch { /* The known result survives failed receipt persistence. */ }','await this.keep(known);','98',None,'lookup survives optional receipt persistence failure'),
 ('pending-persistence-guard','local.ts','try { await history.persistPending(); } catch { retryFlush(); return false; }','await history.persistPending();','13',None,'pending receipt persistence guard schedules flush recovery'),
 ('sync-transport-guard','local.ts','        } catch {\n          setLink("offline");\n          return false;\n        }','        } catch (error) { throw error; }','16',None,'transport failure resolves sync for later dispatch'),
 ('sync-backend-guard','local.ts','          } catch (error) {\n            if (error instanceof BackendAuthError) await refusedSession(error.denied, backendRevision);\n            return false;\n          }','          } catch (error) { if (error instanceof BackendAuthError) await refusedSession(error.denied, backendRevision); throw error; }','22',None,'backend acquisition failure resolves sync for later dispatch'),
 ('native-discovery-guard','local-native.ts','      } catch {\n        return false;\n      }','      } catch (error) { throw error; }','125',None,'optional native installation failure keeps the fallback'),
 ('native-install-guard','local-native.ts','    } catch {\n      return false;\n    }','    } catch (error) { throw error; }','126',None,'optional native installation failure keeps the fallback'),
 ('legacy-json-guard','local-sync.ts','response.clone().json().catch(() => null)','response.clone().json()','117',None,'legacy discovery tolerates an unreadable error body'),
 ('exit-rejection-guard','local-exit.ts','        .catch(() => {})','        .catch(error => { throw error; })','49',None,'RG injected await failure'),
 ('media-serial-guard','local-assets.ts','this.tail = result.catch(() => {});','this.tail = result;','107',None,'media recovers when its host recovers'),
 ('network-serial-guard','local.ts','networkTail = result.catch(() => {});','networkTail = result;','20',None,'optional awaited failure must not strand a healthy queued tail'),
 ('flush-retry-guard','local.ts','      } catch { retryFlush(); }','      } catch {}','68',None,'final observation schedules flush retry'),
 ('new-helper-await','local.ts','  async function flushOnce(acquire = true) {','  async function matrixNewHelper() { await Promise.resolve(); }\n  async function flushOnce(acquire = true) {','census',None,'new or changed await needs delivery reachability classification'),
 ('unclassified-await','local.ts','  async function flushOnce(acquire = true) {','  async function flushOnce(acquire = true) {\n    await Promise.resolve();','census',None,'new or changed await needs delivery reachability classification'),
]
results = [{'name':'prior-rounds','exit':prior.returncode,'killed':prior.returncode==0 and all(prior_assertions.values())}]
for name,file,before,after,site,pattern,assertion in cases:
    if os.environ.get('RG_CONTROL_FILTER') and name not in os.environ['RG_CONTROL_FILTER'].split(','): continue
    target = control/name
    if target.exists(): shutil.rmtree(target)
    (target/'test').mkdir(parents=True)
    for folder in ['dist','src']: shutil.copytree(package/folder,target/folder)
    shutil.copy2(package/'package.json',target/'package.json')
    (target/'node_modules').symlink_to(package/'node_modules',target_is_directory=True)
    for filename in ['store-reset-review.test.mjs','chat-schema.json','delivery-fault-matrix.test.mjs','delivery-fault-fixture.mjs','delivery-fault-instrument.mjs','delivery-fault-recipes.mjs','delivery-fault-sites.json','delivery-await-boundary.json']:
        shutil.copy2(package/'test'/filename,target/'test'/filename)
    path = target/'src'/file
    source = path.read_text()
    assert source.count(before)==1,(name,source.count(before))
    path.write_text(source.replace(before,after))
    # The ordinary audit consumes a normal transpile, without matrix hooks.
    if site=='audit':
        script = "const fs=require('fs'),ts=require('typescript');const source=fs.readFileSync(process.argv[1],'utf8');fs.writeFileSync(process.argv[2],ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,rewriteRelativeImportExtensions:true}}).outputText);"
        subprocess.run(['node','-e',script,str(path),str(target/'dist'/file.replace('.ts','.js'))],cwd=package,check=True)
    env = os.environ.copy()
    for key in ['RG_MATRIX_SITE','RG_MATRIX_CONTROL','RG_MATRIX_MODE','RG_MATRIX_OUTPUT']: env.pop(key,None)
    if site not in ['audit','census']: env.update(RG_MATRIX_SITE=site,RG_MATRIX_CONTROL='1')
    if site=='census': env['RG_MATRIX_SITE']=''
    command=['node','--test','--test-timeout=15000','--test-reporter=tap']
    if pattern: command += ['--test-name-pattern='+pattern]
    command += [str(target/'test'/('store-reset-review.test.mjs' if site=='audit' else 'delivery-fault-matrix.test.mjs'))]
    log_path=out/(name+'.log')
    with log_path.open('w') as log:
        run=subprocess.run(command,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=90)
    killed=run.returncode==1 and assertion in log_path.read_text()
    results.append({'name':name,'exit':run.returncode,'assertion':assertion,'killed':killed})
    print(name,run.returncode,killed,flush=True)
(out/'controls.json').write_text(json.dumps(results,indent=2)+'\n')
assert all(row['killed'] for row in results),results
