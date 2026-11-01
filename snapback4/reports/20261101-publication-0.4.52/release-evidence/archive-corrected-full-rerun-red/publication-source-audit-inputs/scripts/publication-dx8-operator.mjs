import './test-npm-cache.mjs';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {runToolchainCommand} from "./publication-starters.mjs";

export async function proveDX8Operator(directory,client,platform){
 const parent=resolve(directory),scratch=mkdtempSync(join(parent,"dx8-operator-")),root=fileURLToPath(new URL("../",import.meta.url));
 const env={...process.env};delete env.SNAPBACK4_BIN;delete env.PORT_LO;delete env.PORT_HI;
 try{
  writeFileSync(join(scratch,"package.json"),'{"private":true,"type":"module"}');
  await runToolchainCommand("npm",["install","--ignore-scripts","--no-audit","--no-fund",resolve(client),resolve(platform)],{cwd:scratch,env,timeout:300000});
  writeFileSync(join(scratch,"consumer.mjs"),readFileSync(join(root,"scripts/dx8-operator-consumer.mjs")));
  writeFileSync(join(scratch,"test-npm-cache.mjs"),readFileSync(join(root,"scripts/test-npm-cache.mjs")));
  await runToolchainCommand(process.execPath,["consumer.mjs"],{cwd:scratch,env,timeout:240000});
  return {status:"passed",installedSDK:true,developmentClock:"operator authenticated; full/read sessions preserved or expired by policy; restart returns to wall",productionAccounts:"ordinary signup plus service-authorized provisioning",stop:"same-owner release control and lock release",processes:"npm descendants and caller-death cleanup"};
 }finally{rmSync(scratch,{recursive:true,force:true});}
}
