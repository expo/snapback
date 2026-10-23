import {mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {runToolchainCommand} from "./publication-starters.mjs";

export async function proveDX8Inspection(directory,client,platform){
 const parent=resolve(directory),scratch=mkdtempSync(join(parent,"dx8-inspection-")),root=fileURLToPath(new URL("../",import.meta.url));
 const env={...process.env};delete env.SNAPBACK4_BIN;delete env.PORT_LO;delete env.PORT_HI;
 try{
  writeFileSync(join(scratch,"consumer.mjs"),readFileSync(join(root,"scripts/dx8-inspection-consumer.mjs")));
  await runToolchainCommand(process.execPath,["consumer.mjs"],{cwd:scratch,env,timeout:240000});
  return {status:"passed",installedSDK:true,artifacts:{client,platform},savedVersion:"identical-source refresh and importable exact-source client",sql:"wire media object decoding plus explicit JSON truncation",dormant:"counts on sql/data/releases and retained-table guidance",compatibility:"renamed Ref inputs accepted; additive results are notes"};
 }finally{rmSync(scratch,{recursive:true,force:true});}
}
