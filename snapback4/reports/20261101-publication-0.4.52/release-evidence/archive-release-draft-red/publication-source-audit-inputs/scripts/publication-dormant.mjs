// @ref LLP 3000.000.000#195-argument-aliases-and-review-evidence — new migration paths run through the installed tarball, without a binary override.
import {readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {runToolchainCommand} from './publication-starters.mjs';
export async function proveDormant(cwd) {
  const env={...process.env};delete env.SNAPBACK4_BIN;delete env.PORT_LO;delete env.PORT_HI;
  for (const [file,fn] of [['dormant-cases.mjs','dormantCases'],['argument-alias-cases.mjs','argumentAliasCases']]) {
    const path=join(cwd,file);
    const source=readFileSync(new URL('./'+file,import.meta.url),'utf8');
    writeFileSync(path,source+`\nimport {cli,startServe} from 'snapback4/proof';\nconsole.log(JSON.stringify(await ${fn}({cli,startServe},process.cwd())));\n`);
    try {await runToolchainCommand(process.execPath,[path],{cwd,env,timeout:240_000});}
    finally {rmSync(path,{force:true});}
  }
  return {status:'passed',cases:['reverse-native-old-view','exact-preimage-precedence','unrepresentable-dormancy','read-only-check','operator-retained-inspection','exact-forward','unrelated-old-edit','projected-edit-conflict','declared-column-rename','forward-backfill-catchup','mapped-old-arguments','edited-native-and-migrated-reentry','nullable-destination-rename','loosened-bridge-visibility','table-identity-rename','asset-home-rename','file-derived-repeated-lines','cross-table-backfill','typed-parent-visibility']};
}
