function convexResult(payload: any) {
  if (payload?.status === 'success') return payload.value;
  throw new Error(payload?.errorMessage || payload?.errorData || 'Convex request failed');
}

export function convexDeploymentUrl(value: string) {
  if (value.startsWith('http')) return value.replace(/\.convex\.site\/?$/, '.convex.cloud');
  const descriptor = value.split('|', 1)[0];
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
