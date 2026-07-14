const CLOUDFLARE_PROFILE = 'cloudflare-do-sqlite-v8';
const LOCAL_PROFILE = 'local-dev-sqlite-ibex';

function serverRoot(serverOrigin) {
  if (typeof serverOrigin !== 'string' || serverOrigin.trim().length === 0) {
    throw new Error('same-origin native startup requires an Exact server origin');
  }
  return serverOrigin.trim().replace(/\/+$/, '');
}

// Resolve the API base from explicit build facts. `same-origin` is only an
// origin-placement sentinel: the local Vite target serves Snapback under its
// /snapback proxy, while the Cloudflare gateway owns API routes at `/`.
// @ref LLP 0049#realtime-and-browser-surface — hosted web/native clients address the gateway root.
export function snapbackBaseUrlForTarget({
  configuredOrigin,
  serverOrigin,
  surface,
  targetProfile,
}) {
  if (surface !== 'web' && surface !== 'native') {
    throw new TypeError(`unsupported Snapback client surface ${JSON.stringify(surface)}`);
  }
  if (targetProfile !== CLOUDFLARE_PROFILE && targetProfile !== LOCAL_PROFILE) {
    throw new TypeError(`unsupported Snapback target profile ${JSON.stringify(targetProfile)}`);
  }
  if (configuredOrigin === 'same-origin') {
    if (surface === 'web') {
      return targetProfile === CLOUDFLARE_PROFILE ? '' : '/snapback';
    }
    const root = serverRoot(serverOrigin);
    return targetProfile === CLOUDFLARE_PROFILE ? root : `${root}/snapback`;
  }
  if (typeof configuredOrigin === 'string' && configuredOrigin.length > 0) {
    return configuredOrigin;
  }
  return typeof serverOrigin === 'string' && serverOrigin.length > 0
    ? `${serverRoot(serverOrigin)}/snapback`
    : '/snapback';
}
