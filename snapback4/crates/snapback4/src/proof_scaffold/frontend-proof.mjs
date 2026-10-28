// EDIT frontend.assert in cases.mjs. Same real sessions/roles as acceptance and probe.
import assert from 'node:assert/strict';
import { command, startStatic, withBrowser, fillRN, bounded, renderedText, waitForFresh, cleanup } from 'snapback4/proof';
import { frontend } from './cases.mjs';
import { startProof } from './host.mjs';
assert.equal(typeof frontend.assert, 'function', 'E_FRONTEND_SCENARIO: fill frontend.assert in cases.mjs with a UI write, SDK receipt and fresh rendered result per role');
const build = await command('npm',['run',frontend.build],{timeoutMs:300000});
assert.equal(build.code,0,`frontend build failed; ${build.logs.stderr}`);
const ctx=await startProof(); let web;
try {
  web=await startStatic(frontend.directory);
  // Separate browser context per account prevents one role's login leaking into another.
  for(const accounts of Object.values(ctx.sessions)) for(const account of accounts) {
    await withBrowser({executablePath:process.env.CHROME},async browser => {
      const page=await browser.newPage();
      await page.goto(`${web.url}/?api=${encodeURIComponent(ctx.host.url)}&witness=web`);
      await fillRN(page.getByLabel('Email',{exact:true}),account.email);
      await fillRN(page.getByLabel('Password',{exact:true}),account.password);
      await page.getByRole('button',{name:'Sign in',exact:true}).click();
      // In frontend.assert: await button.evaluate(el => window.__snapback4Witness.beginForm('OP', ARGS, el));
      // await button.click(); const receipt=await bounded(page.evaluate(() => window.__snapback4Witness.formResult()),30000,'UI write');
      // assert.equal(receipt.state,'sent'); await waitForFresh(renderedText(page,uniqueText),null);
      // For excluded roles assert the refusal code and unchanged visible state.
      await frontend.assert(page,{...ctx,bounded,renderedText,waitForFresh,fillRN},account);
    });
  }
  console.log('frontend:proof: real-role UI assertions passed');
} finally { await cleanup(() => web?.stop(), () => ctx.stop()); }
