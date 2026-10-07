import {chromium} from 'playwright-core';
import {chromiumExecutable} from '../../witness/lib.mjs';
import fs from 'node:fs';
const browser=await chromium.launch({executablePath:chromiumExecutable(),headless:true});
try{const page=await browser.newPage();page.on('console',m=>console.log(m.type(),m.text()));page.on('pageerror',e=>console.log('PAGEERROR',e.message));await page.goto('http://127.0.0.1:45189');await page.waitForFunction(()=>globalThis.uaEvents?.some(e=>e.event==='image-load'),{},{timeout:30000});console.log(JSON.stringify(await page.evaluate(()=>globalThis.uaEvents)));await page.screenshot({path:'target/ua/web.png'});fs.writeFileSync('target/ua/web-events.json',JSON.stringify(await page.evaluate(()=>globalThis.uaEvents),null,2));}finally{await browser.close()}
