// @ref LLP 3000.037.000#starter-verification-and-repair-guidance-starter2 — UI session switching waits for credential removal and screen readiness.
/** UI helpers for the password starter's labelled controls. Custom screens keep
 * their own selectors and business assertions. No backend login bypass. */
import type { Locator, Page } from 'playwright-core';
import { fillRN } from './proof.ts';

/** Sign out an existing starter session before signing in as this account.
 * Waits for the signed-in screen, including session restoration and device open.
 * @throws Playwright selector/action deadline or authentication failure. */
export async function signInUI(page: Page, account: { email: string; password: string }): Promise<void> {
  const email = page.getByLabel('Email', { exact: true });
  const signOut = page.getByRole('button', { name: 'Sign out', exact: true });
  // A reload may restore credentials instead of rendering the sign-in form.
  await email.or(signOut).first().waitFor({ state: 'visible' });
  if (await signOut.isVisible()) await signOutUI(page);
  await fillRN(email, account.email);
  await fillRN(page.getByLabel('Password', { exact: true }), account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await signOut.waitFor({ state: 'visible' });
}

/** Wait for credential removal and the signed-out form before another login.
 * @throws Playwright selector/action deadline. */
export async function signOutUI(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).waitFor({ state: 'visible' });
}
