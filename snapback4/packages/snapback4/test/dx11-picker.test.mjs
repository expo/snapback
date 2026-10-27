// Generation/adaptation fixtures defer dependency installation; packed starters exercise the installer.
process.env.SNAPBACK4_INIT_INSTALL = "0";
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, symlinkSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createBrowserServer, loadBrowserPage } from './helpers/browser-server.mjs';
import { chromiumExecutable } from '../../../witness/lib.mjs';
const root=resolve(import.meta.dirname,'../../..');

test('packed Expo UploadPicker uploads a real web selection and reports admission errors', {timeout:90000}, async t=>{
 let executablePath;try{executablePath=chromiumExecutable();}catch(error){t.skip(`Chromium unavailable: ${error.message}`);return;}
 const dir=mkdtempSync(join(tmpdir(),'sb4-dx11-picker-'));let browser,vite;
 t.after(async()=>{await browser?.close();await vite?.close();rmSync(dir,{recursive:true,force:true});});
 const run=(exe,args,cwd=dir)=>execFileSync(exe,args,{cwd,encoding:'utf8',maxBuffer:4*1024*1024});
 const tar=JSON.parse(run('npm',['pack','--ignore-scripts','--json','--pack-destination',dir],join(root,'packages/snapback4')))[0].filename;
 run('tar',['-xzf',join(dir,tar),'-C',dir]);mkdirSync(join(dir,'node_modules'));symlinkSync(join(dir,'package'),join(dir,'node_modules/snapback4'));
 const nativeName=`snapback4-${process.platform}-${process.arch}`;mkdirSync(join(dir,'node_modules',nativeName));
 copyFileSync(join(root,'packages',nativeName,'package.json'),join(dir,'node_modules',nativeName,'package.json'));
 copyFileSync(process.env.SNAPBACK4_BIN??join(root,'target/debug/snapback4'),join(dir,'node_modules',nativeName,'snapback4'));
 const env={...process.env};delete env.SNAPBACK4_BIN;
 execFileSync(process.execPath,[join(dir,'package/bin/snapback4.js'),'init',dir,'--expo'],{cwd:dir,env,stdio:'pipe'});
 writeFileSync(join(dir,'tsconfig.json'),JSON.stringify({compilerOptions:{jsx:'react-jsx',target:'ES2022',module:'ESNext'}}));
 writeFileSync(join(dir,'index.html'),'<div id="root"></div><script type="module" src="/main.tsx"></script>');
 writeFileSync(join(dir,'main.tsx'),`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {SnapbackProvider} from 'snapback4/react';import {UploadPicker} from './src/UploadPicker';
 const client={upload:async bytes=>{window.uploads=(window.uploads??0)+1;window.byteCount=bytes.size;await new Promise(r=>setTimeout(r,30));return window.refuse?{ok:false,why:{code:'E_RATE_LIMIT',message:'Upload busy; retry sequentially'}}:{ok:true,asset:{id:'selected-photo'}}}};
 function App(){const[id,setId]=useState('');return <SnapbackProvider client={client}><UploadPicker onUploaded={setId}/><p>{id}</p></SnapbackProvider>};createRoot(document.getElementById('root')).render(<App/>);`);
 vite=await createBrowserServer({root:dir,server:{host:'127.0.0.1',port:0,fs:{allow:[dir,root]}},optimizeDeps:{noDiscovery:true,include:[]},resolve:{alias:[{find:'snapback4/react',replacement:join(dir,'package/dist/react.js')}]},plugins:[{name:'native-host',resolveId(id){if(id==='react-native')return '\0native';if(id==='expo-image-picker')return '\0picker';},load(id){if(id==='\0native')return `import React from 'react';export const Platform={OS:'web'};export const View=({children})=>React.createElement('div',null,children);export const Text=({children})=>React.createElement('p',{role:'alert'},children);export const Button=()=>null;`;if(id==='\0picker')return 'export function launchImageLibraryAsync(){throw Error("web must use the file input")}';}}]});
 await vite.listen();const {chromium}=createRequire(join(root,'package.json'))('playwright-core');browser=await chromium.launch({executablePath,headless:true,args:process.getuid?.()===0?['--no-sandbox']:[]});const page=await browser.newPage();await loadBrowserPage(t,page,`http://127.0.0.1:${vite.httpServer.address().port}`);
 const input=page.getByLabel('Choose image');await input.setInputFiles({name:'photo.png',mimeType:'image/png',buffer:Buffer.from([137,80,78,71,13,10,26,10])});await page.getByText('selected-photo',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.byteCount),8);
 await page.evaluate(()=>window.refuse=true);await input.setInputFiles({name:'photo.png',mimeType:'image/png',buffer:Buffer.from([137,80,78,71])});await page.getByText('Upload busy; retry sequentially',{exact:true}).waitFor();assert.equal(await input.isEnabled(),true);assert.equal(await page.evaluate(()=>window.uploads),2);
});
