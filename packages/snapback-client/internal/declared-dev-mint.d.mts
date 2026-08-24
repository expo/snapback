export interface SnapbackDeploymentIdentity {
  readonly schemaVersion: string;
  readonly authMode: string;
  readonly appId: string;
  readonly schemaHash: string;
  readonly bundleHash: string;
  readonly inputsHash: string;
}

export interface DeclaredDevCapability {
  readonly format: 'snapback.declared-dev-capability.v1';
  readonly deploymentIdentity: Readonly<SnapbackDeploymentIdentity>;
}

/** Not public API — generated-code seam only. */
export function mintDeclaredDevCapability(
  deploymentIdentity: Readonly<SnapbackDeploymentIdentity>,
): DeclaredDevCapability;

/**
 * UNSAFE generated-code-only seam, outside the security boundary.
 * In-process importers have application-author standing; data-borne values do not.
 */
export function unsafeInstallDeclaredDevCapabilityForGeneratedCode(
  app: object,
  deploymentIdentity: Readonly<SnapbackDeploymentIdentity>,
): DeclaredDevCapability;
