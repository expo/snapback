// Reuse the passed implementation scope; only the day-two card and its witness changed.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
const base='882daf8917b795444663e3d57b73dba8c485cd85';
const receipt=JSON.parse(gunzipSync(readFileSync('snapback4/reports/20261027-dx16/affected-implementation.json.gz')));
if(receipt.head!==base||!receipt.ok||!receipt.complete||!receipt.unchanged||receipt.results.some(item=>item.status!==0))throw Error('Implementation receipt incomplete or failed');
const allowed=new Set(['WORKSTREAM-REPORT.md','llp/3000.037.000-wave-30-default-verdict-and-password-starters.rfc.md','issues/20261028-snapback4-clean-userspace-deepmerge-audit.md','snapback4/crates/snapback4-lang/src/guide/day2.md','snapback4/crates/snapback4/tests/dx16.rs','snapback4/scripts/publication-dx16.mjs']);
const changed=execFileSync('git',['diff','--name-only',base,'HEAD'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
const unexpected=changed.filter(path=>!allowed.has(path)&&!path.startsWith('snapback4/reports/20261027-dx16/')&&!path.startsWith('llp/reviews/3000.037.000-dx16-'));
if(unexpected.length)throw Error('Additional product inputs changed: '+unexpected);
const packed=JSON.parse(readFileSync('snapback4/reports/20261027-dx16/packed-linux5-summary.json'));
if(packed.source!==base||packed.hostProofs.length!==19||packed.hostProofs.some(item=>item.status!=='passed')||packed.proofKit?.status!=='passed'||packed.failure?.stage!=='host Expo starter audit')throw Error('Packed consumer evidence differs from the recorded audit stop');
const fresh=JSON.parse(readFileSync('snapback4/reports/20261027-dx16/packed-unused-snapshots.json'));
if(fresh.status!=='passed'||!fresh.unusedSavedVersions||!fresh.freshStarterCapture||fresh.runs!==2||!fresh.retainedSnapshot)throw Error('Saved-version handover proof missing');
console.log('Prior implementation: 19 affected steps and functional packed consumers passed. Product code unchanged; rerun the corrected guide/native witness/current packed DX16 in this plan. Expo starter audit blocks qualification; no waiver.');
