import { GatewayContractProvider } from './provider.js';
import {
  configurePartitimeLinks,
  resetPartitimeLinks,
  type PartitimeLinks,
} from './data/runtime-links.js';

declare const __PARTITIME_BACKEND__: 'snapback' | 'supabase' | 'convex' | 'sqlite';
declare const __PARTITIME_GATEWAY_ORIGIN__: string;

type PartitimePerformanceGlobal = typeof globalThis & {
  __partitimeReportFirstAuthoritativeData?: (
    backend: string,
    rowCount: number,
  ) => void;
};

/** Configure one backend-neutral Contract provider before the router mounts. */
export function configurePartitimeData(): () => void {
  const performanceGlobal = globalThis as PartitimePerformanceGlobal;
  const provider = new GatewayContractProvider(
    __PARTITIME_BACKEND__,
    __PARTITIME_GATEWAY_ORIGIN__,
    'user_ada',
    (rowCount) => {
      performanceGlobal.__partitimeReportFirstAuthoritativeData?.(
        __PARTITIME_BACKEND__,
        rowCount,
      );
    },
  );
  configurePartitimeLinks(provider.links() as PartitimeLinks);
  return () => {
    provider.dispose();
    resetPartitimeLinks();
  };
}
