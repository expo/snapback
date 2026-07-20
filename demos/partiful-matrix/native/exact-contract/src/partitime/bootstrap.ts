import { GatewayContractProvider } from './provider.js';
import {
  configurePartitimeLinks,
  resetPartitimeLinks,
  type PartitimeLinks,
} from './data/runtime-links.js';

declare const __PARTITIME_BACKEND__: 'snapback' | 'supabase' | 'convex' | 'sqlite';
declare const __PARTITIME_GATEWAY_ORIGIN__: string;

/** Configure one backend-neutral Contract provider before the router mounts. */
export function configurePartitimeData(): () => void {
  const provider = new GatewayContractProvider(
    __PARTITIME_BACKEND__,
    __PARTITIME_GATEWAY_ORIGIN__,
    'user_ada',
  );
  configurePartitimeLinks(provider.links() as PartitimeLinks);
  return () => {
    provider.dispose();
    resetPartitimeLinks();
  };
}
