// @ref LLP 3000.000.000.002#10-wave-25-day-two-friction-dx8 — execute changed recipes against one installed client/platform pair.
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {runToolchainCommand} from "./publication-starters.mjs";
import {proveDX8Operator} from "./publication-dx8-operator.mjs";
import {proveDX8Inspection} from "./publication-dx8-inspection.mjs";
import {proveDX8Ergonomics} from "./publication-dx8-ergonomics.mjs";
export async function proveDX8(directory,client,platform){
 const operator=await proveDX8Operator(directory,client,platform);
 const inspection=await proveDX8Inspection(directory,client,platform);
 const ergonomics=await proveDX8Ergonomics(directory,client,platform);
 const scratch=mkdtempSync(join(resolve(directory),"dx8-migrations-")),root=fileURLToPath(new URL("../",import.meta.url));
 const env={...process.env};delete env.SNAPBACK4_BIN;delete env.PORT_LO;delete env.PORT_HI;
 try{
  writeFileSync(join(scratch,"consumer.mjs"),readFileSync(join(root,"scripts/dx8-migrations-consumer.mjs")));
  await runToolchainCommand(process.execPath,["consumer.mjs"],{cwd:scratch,env,timeout:300000});
 }finally{rmSync(scratch,{recursive:true,force:true});}
 return {status:"passed",installedSDK:true,operator,inspection,ergonomics,migrations:"verbatim installed fan-out and pre-patch language recipes"};
}
