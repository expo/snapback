export type DevPortPlanOwnerName = 'backend' | 'client' | 'bootstrap' | 'metro';
export type DevPortPlanProfile = 'plain' | 'external-client' | 'client-command' | 'expo';

export interface DevPortPlanRange {
  readonly lo: number;
  readonly hi: number;
  readonly source: 'default' | 'flag' | 'env';
}

export interface DevPortPlanOwner {
  readonly owner: DevPortPlanOwnerName;
  readonly port: number | null;
  readonly source: 'pinned' | 'range' | 'attached';
  readonly declaredBy: 'flag' | 'env' | null;
}

export interface DevPortPlan {
  readonly range: DevPortPlanRange;
  readonly owners: readonly DevPortPlanOwner[];
}

export type DevPortPlanOwnerProvenance = Readonly<{
  source: DevPortPlanOwner['source'];
  declaredBy: DevPortPlanOwner['declaredBy'];
}>;

export const DEFAULT_DEV_PORT_RANGE: Readonly<{ lo: 4287; hi: 4387 }>;
export const DEV_PORT_ENVIRONMENT: Readonly<{
  backend: 'SNAPBACK_DEV_PORT';
  client: 'SNAPBACK_DEV_CLIENT_PORT';
  bootstrap: 'SNAPBACK_DEV_BOOTSTRAP_PORT';
  range: 'SNAPBACK_DEV_PORT_RANGE';
}>;

export function resolveDevPortPlan(options?: Readonly<{
  profile?: DevPortPlanProfile;
  platform?: 'ios' | 'android' | 'web';
  flags?: Readonly<{
    port?: string | number | null;
    clientPort?: string | number | null;
    bootstrapPort?: string | number | null;
    portRange?: string | null;
  }>;
  env?: Readonly<Record<string, string | undefined>>;
}>): DevPortPlan;

export function materializeDevPortPlan(
  plan: DevPortPlan,
  assignedPorts?: Readonly<Partial<Record<DevPortPlanOwnerName, number>>>,
  ownerProvenance?: Readonly<Partial<Record<DevPortPlanOwnerName, DevPortPlanOwnerProvenance>>>,
): DevPortPlan;

export function devPortPlanOwner(
  plan: DevPortPlan,
  owner: DevPortPlanOwnerName,
): DevPortPlanOwner | null;
