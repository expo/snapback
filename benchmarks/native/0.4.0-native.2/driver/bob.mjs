import { conversation } from './bob-wait.mjs';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(process.env.CLIQUE_PLAYWRIGHT_PACKAGE);
const { chromium } = require('playwright');
const f = JSON.parse(fs.readFileSync(0, 'utf8'));
const browser = await chromium.launch({ headless: true });
try {
 const page = await browser.newPage();
 await page.goto(f.webOrigin);
 await page.getByTestId('sm-auth-email').fill(process.env.CLIQUE_BOB_EMAIL);
 await page.getByTestId('sm-auth-password').fill(process.env.CLIQUE_BOB_PASSWORD);
 await page.getByTestId('sm-auth-submit').click();
 await page.locator(`[data-testid="sm-chats-item"][aria-valuetext="${f.chatValue}"]`).click();
 console.log(JSON.stringify(await conversation(page, f, f.uiBoundMs ?? 10000)));
} finally { await browser.close(); }
