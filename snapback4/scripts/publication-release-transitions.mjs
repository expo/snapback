// @ref LLP 3000.000.000.000#11-old-client-operation-contracts-rel5 — the installed guide is the source exercised by packed qualification.
import {readFileSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {runToolchainCommand} from './publication-starters.mjs';
export async function proveReleaseTransitions(cwd) {
  const path=join(cwd,'release-transitions.mjs');
  const source=readFileSync(new URL('./release-transitions-cases.mjs',import.meta.url),'utf8');
  writeFileSync(path,source+`\nimport {cli,startServe} from 'snapback4/proof';\nconsole.log(JSON.stringify(await releaseTransitions({cli,startServe},process.cwd())));\n`);
  const env={...process.env};delete env.SNAPBACK4_BIN;delete env.PORT_LO;delete env.PORT_HI;
  try {await runToolchainCommand(process.execPath,[path],{cwd,env,timeout:240_000});}
  finally {rmSync(path,{force:true});}
  return {status:'passed',cases:['reactivation','refused-deploy-cleanliness','rollback-foresight','old-client-diff','installed-v1-v2-guide']};
}
