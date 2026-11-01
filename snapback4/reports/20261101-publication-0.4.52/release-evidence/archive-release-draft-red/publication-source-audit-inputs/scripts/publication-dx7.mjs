import {mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {runToolchainCommand} from "./publication-starters.mjs";
import {chromiumExecutable} from "../witness/lib.mjs";
import {proveDX7Upgrades} from "./publication-dx7-upgrade.mjs";
export async function proveDX7(directory,client,platform){
 const parent=resolve(directory),scratch=mkdtempSync(join(parent,"dx7-")),root=fileURLToPath(new URL("../",import.meta.url));
 const env={...process.env,CHROME:chromiumExecutable()};delete env.SNAPBACK4_BIN;delete env.PORT_LO;delete env.PORT_HI;
 try{
  writeFileSync(join(scratch,"consumer.mjs"),readFileSync(join(root,"scripts/dx7-consumer.mjs")));
  await runToolchainCommand(process.execPath,["consumer.mjs"],{cwd:scratch,env,timeout:180000});
  const upgrades=await proveDX7Upgrades(client,platform);
  return {status:"passed",installedSDK:true,guide:"verbatim rules recipe",clock:"reused-store advance/pause/restart/drain, explicit offset, production refusal",text:"scrollable RN text, nested real clips, negative origin and hidden controls",schema:"protected immutable update/upsert and hidden program probes",upgrades};
 }finally{rmSync(scratch,{recursive:true,force:true});}
}
