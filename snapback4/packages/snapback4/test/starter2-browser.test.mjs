import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withBrowser, signInUI, signOutUI, selectByValue, labelledControl } from '../dist/proof.js';

test('password UI switches restored accounts and waits for delayed signed-in controls', async t => {
  const cwd=mkdtempSync(join(tmpdir(),'starter2-browser-'));
  t.after(()=>rmSync(cwd,{recursive:true,force:true}));
  await withBrowser({ cwd, executablePath:process.env.CHROME },async context=>{
    const page=await context.newPage();
    await page.setContent(String.raw`<div id="root">Restoring…</div><script>
      window.accounts=[];
      function signedIn(){document.querySelector('#root').innerHTML='<button onclick="setTimeout(signedOut,80)">Sign out</button>';}
      function signedOut(){document.querySelector('#root').innerHTML='<label>Email<input id="email"></label><label>Password<input type="password"></label><button onclick="accounts.push(document.querySelector(\'#email\').value);setTimeout(signedIn,80)">Sign in</button>';}
      setTimeout(signedIn,80);
    </script>`);
    await signInUI(page,{email:'first@example.test',password:'first'});
    await signInUI(page,{email:'second@example.test',password:'second'});
    assert.deepEqual(await page.evaluate(()=>window.accounts),['first@example.test','second@example.test']);
    await signOutUI(page);
    assert.equal(await page.getByLabel('Email',{exact:true}).isVisible(),true);
    // Explicit names remain exact even as options load/change after sign-in.
    await page.setContent('<label>Owner<select><option value="a">Account A</option><option value="b">Account B</option></select></label>');
    await selectByValue(labelledControl(page,'combobox','Owner'),'b');
    assert.equal(await labelledControl(page,'combobox','Owner').inputValue(),'b');
    await page.setContent('<label>Owner<select><option value="b">B</option></select></label><label>Owner<select><option value="b">B</option></select></label>');
    await assert.rejects(selectByValue(labelledControl(page,'combobox','Owner'),'b'),/strict mode violation/);
  });
});
