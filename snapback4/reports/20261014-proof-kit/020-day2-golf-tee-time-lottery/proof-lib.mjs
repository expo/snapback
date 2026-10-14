import assert from "node:assert/strict";
import { cli } from "snapback4/proof";
export const root = process.cwd();
export async function post(url, path, body, session) {
  const response = await fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(session && { authorization: `Bearer ${session.token ?? session}` }) }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  return { status: response.status, body: await response.json() };
}
export function accountApi(url, session) {
  return {
    q: async (op, args = {}) => { const { body } = await post(url, `/q/${op}`, { args }, session); assert(!body.denied, JSON.stringify(body)); return body.data; },
    m: async (op, args = {}) => { const { body } = await post(url, `/m/${op}`, { args }, session); assert.equal(body.state, 'sent', JSON.stringify(body)); return body; },
    raw: async (op, args = {}) => (await post(url, `/m/${op}`, { args }, session)).body,
  };
}
export const password = 'Tee-time-proof-2026!';
export async function signup(url, email) {
  const { status, body } = await post(url, '/auth/signup', { email, password });
  assert.equal(status, 200, JSON.stringify(body)); assert(body.session?.token, JSON.stringify(body)); return body.session;
}
export async function grantStaff(url, deploy, principal) {
  const token = (await cli(['token', '--service', 'ops', '--release', deploy], {})).stdout.trim();
  await accountApi(url, token).m('grantStaff', { principal });
}
