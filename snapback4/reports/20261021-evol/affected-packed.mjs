// Run from the repository root after snapback4/scripts/build-linux-musl.sh. This is a scoped consumer witness, never a publication receipt.
import {copyFileSync,mkdirSync,mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {artifact,cleanSource,digest,json,run,save,manifest,clientManifest} from '../../scripts/publication-artifacts.mjs';
import {checkElf} from '../../scripts/check-elf.mjs';
import {proveDay2} from '../../scripts/publication-day2.mjs';
import {proveDormant} from '../../scripts/publication-dormant.mjs';
import {proveMigrations} from '../../scripts/publication-migrations.mjs';
import {proveReleaseTransitions} from '../../scripts/publication-release-transitions.mjs';
const root=resolve('snapback4'),source=cleanSource(root),out=resolve('evol-affected-qualified');mkdirSync(out);
const full=json('snapback4/reports/20261021-evol/consumer.json');
const client=resolve('snapback4/reports/20261021-evol/artifacts/full/snapback4-0.4.35.tgz');const version='0.4.35';clientManifest(client,version);
if(artifact(client,'snapback4',version).integrity!==full.clientIntegrity)throw Error('client differs from full qualification');
const binary=join(root,'target/x86_64-unknown-linux-musl/production/snapback4');
const elf=checkElf(readFileSync(binary));if(run(binary,['--version']).trim()!==`snapback4 ${version}`)throw Error('binary version mismatch');
const scratch=mkdtempSync(resolve('evol-affected-package-'));
try {
 const pkg=join(scratch,'package');mkdirSync(pkg);
 for(const f of ['package.json','THIRD-PARTY-NOTICES'])copyFileSync(join(root,'packages/snapback4-linux-x64',f),join(pkg,f));
 copyFileSync(binary,join(pkg,'snapback4'));
 const [packed]=JSON.parse(run('npm',['pack','--ignore-scripts','--json','--pack-destination',out],{cwd:pkg}));
 const platform=join(out,packed.filename);manifest(platform,'snapback4-linux-x64',version);
 const day2=await proveDay2(client,platform,out);save(join(out,'day2-proof.json'),day2);
 const dormant=await proveDormant(day2.directory);save(join(out,'dormant.json'),dormant);
 const transitions=await proveReleaseTransitions(day2.directory);save(join(out,'release-transitions.json'),transitions);
 const migrations=await proveMigrations(client,platform,out);save(join(out,'migrations.json'),migrations);
 if(cleanSource(root)!==source)throw Error('source changed during affected qualification');
 const result={format:1,mode:'affected-consumer-requalification',source,version,publicationQualified:false,
 scope:'Only human preview wording changed: distinguish retained empty/default images and preimage ownership. JSON counts, schema, activation and SDK are unchanged.',
 fullQualification:{source:full.source,sha256:digest('snapback4/reports/20261021-evol/consumer.json'),file:'consumer.json'},
 client:artifact(client,'snapback4',version),platform:artifact(platform,'snapback4-linux-x64',version),binarySha256:digest(binary),elf,day2,dormant,transitions,migrations};
 save(join(out,'affected.json'),result);console.log(JSON.stringify(result,null,2));
} finally {rmSync(scratch,{recursive:true,force:true});}
