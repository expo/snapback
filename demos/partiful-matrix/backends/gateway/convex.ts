function convexResult(payload: any) {
  if (payload?.status === 'success') return payload.value;
  throw new Error(payload?.errorMessage || payload?.errorData || 'Convex request failed');
}

export function convexDeploymentUrl(value: string) {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);
    if (url.username || url.password) {
      throw new Error('Convex deployment URL must not contain credentials');
    }
    if (url.search || url.hash || url.pathname.replace(/\//g, '') !== '') {
      throw new Error('Convex deployment URL must be a bare origin');
    }
    // Dashboard copy buttons sometimes hand out the HTTP-actions
    // `.convex.site` origin. Query and mutation HTTP endpoints, as well as the
    // browser client, use the sibling `.convex.cloud` deployment origin.
    if (url.hostname.endsWith('.convex.site')) {
      url.hostname = `${url.hostname.slice(0, -'.convex.site'.length)}.convex.cloud`;
    }
    return url.origin;
  }
  const descriptor = trimmed.split('|', 1)[0];
  const deploymentName = descriptor.split(':').at(-1);
  if (!deploymentName || !/^[a-z0-9-]+$/.test(deploymentName)) {
    throw new Error('could not derive the Convex deployment URL from the deploy key');
  }
  return `https://${deploymentName}.convex.cloud`;
}

export function createConvexAdapter(baseUrl: string) {
  // Dashboard copy buttons sometimes hand out the HTTP-actions `.convex.site`
  // origin. Convex's query/mutation HTTP API lives on the sibling deployment
  // `.convex.cloud` origin.
  baseUrl = convexDeploymentUrl(baseUrl);
  const call = async (kind: 'query' | 'mutation', name: string, args: Record<string, unknown>) => {
    const response = await fetch(`${baseUrl}/api/${kind}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: `events:${name}`, args, format: 'json' }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.errorMessage || `Convex HTTP ${response.status}`);
    return convexResult(payload);
  };
  return {
    backend: 'convex',
    query(name: string, args: Record<string, unknown>) { return call('query', name, args); },
    mutate(name: string, args: Record<string, any>, userId: string) {
      return call('mutation', name, { ...args, userId });
    },
    cleanupAcceptanceEvent(eventId: string) {
      return call('mutation', 'cleanupAcceptanceEvent', { eventId });
    },
    close() {},
  };
}
