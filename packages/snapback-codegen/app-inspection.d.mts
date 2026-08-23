export interface AppInspectionSourceSpanV1 {
  readonly file: string;
  readonly line?: number;
  readonly column?: number;
}

export interface AppInspectionReferenceV1 {
  readonly name: string;
  readonly id: string;
  readonly kind: string;
  readonly sourceSpan: AppInspectionSourceSpanV1 | null;
  readonly requiredCapabilities: readonly string[];
}

export interface AppInspectionCommandAssetV1 {
  readonly input: string;
  readonly mutationArg: string;
  readonly optional: boolean;
  readonly intent: AppInspectionReferenceV1;
}

export interface AppInspectionAssetCommandV1 {
  readonly name: string;
  readonly kind: 'asset-bearing-command.v1';
  readonly mutation: AppInspectionReferenceV1;
  readonly asset: AppInspectionCommandAssetV1 | null;
  readonly passthroughArgs: readonly string[];
  readonly requiredCapabilities: readonly string[];
}

export interface AppInspectionMediaCommandV1 {
  readonly name: string;
  readonly kind: 'media-command.v1';
  readonly mutation: AppInspectionReferenceV1;
  readonly intent: AppInspectionReferenceV1;
  readonly binding: Readonly<Record<string, unknown>>;
  readonly passthroughArgs: readonly string[];
  readonly requiredCapabilities: readonly string[];
}

export type AppInspectionCommandV1 =
  | AppInspectionAssetCommandV1
  | AppInspectionMediaCommandV1;

export interface AppInspectionNamedBindingV1 {
  readonly kind: 'param' | 'input';
  readonly name: string;
}

export interface AppInspectionLiteralBindingV1 {
  readonly kind: 'literal';
  readonly value: unknown;
}

export type AppInspectionBindingLeafV1 =
  | AppInspectionNamedBindingV1
  | AppInspectionLiteralBindingV1;

export interface AppInspectionScopeBindingV1 {
  readonly kind: 'scope';
  readonly fields: Readonly<Record<string, AppInspectionBindingLeafV1>>;
}

export type AppInspectionBindingV1 =
  | AppInspectionBindingLeafV1
  | AppInspectionScopeBindingV1;

export interface AppInspectionMemberInputV1 {
  readonly contract: Readonly<Record<string, unknown>>;
  readonly optional: boolean;
}

export interface AppInspectionMemberV1<
  Reference extends AppInspectionReferenceV1 | AppInspectionCommandV1,
> {
  readonly name: string;
  readonly reference: Reference;
  readonly bindings: Readonly<Record<string, AppInspectionBindingV1>>;
  readonly inputs: Readonly<Record<string, AppInspectionMemberInputV1>>;
  readonly requiredCapabilities: readonly string[];
}

export type AppInspectionReferenceMemberV1 =
  AppInspectionMemberV1<AppInspectionReferenceV1>;
export type AppInspectionCommandMemberV1 =
  AppInspectionMemberV1<AppInspectionCommandV1>;

export interface AppInspectionApiV1 {
  readonly queries: readonly AppInspectionReferenceV1[];
  readonly mutations: readonly AppInspectionReferenceV1[];
  readonly assets: readonly AppInspectionReferenceV1[];
  readonly ephemeral: readonly AppInspectionReferenceV1[];
  readonly queryGroups: readonly AppInspectionReferenceV1[];
}

export interface AppInspectionSurfaceMembersV1 {
  readonly reads: readonly AppInspectionReferenceMemberV1[];
  readonly mutations: readonly AppInspectionReferenceMemberV1[];
  readonly commands: readonly AppInspectionCommandMemberV1[];
  readonly assets: readonly AppInspectionReferenceMemberV1[];
  readonly presence: readonly AppInspectionReferenceMemberV1[];
}

export interface AppInspectionSurfaceV1 {
  readonly name: string;
  readonly id: string;
  readonly kind: 'surfaceDescriptor';
  readonly sourceSpan: AppInspectionSourceSpanV1;
  readonly params: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly members: AppInspectionSurfaceMembersV1;
}

export interface AppDescriptorInspectionV1 {
  readonly format: 'snapback.app.v1';
  readonly authBootstrap?: Readonly<{
    format: 'snapback.application-auth-bootstrap.v1';
    appId: string;
    mode: 'sessions';
    custody: 'durable-required' | 'volatile-explicit';
    entryMechanisms: readonly ('guest-v1' | 'password-v1' | 'email-code-v1' | 'external-session-explicit-v1')[];
    anonymousPublic: 'allowed' | 'refused';
    lifecycleProtocol: 1;
  }>;
  readonly identity: Readonly<{
    app: string;
    schema: string;
    functions: string;
    descriptor: string;
  }>;
  readonly capabilities: Readonly<{ required: readonly string[] }>;
  readonly api: AppInspectionApiV1;
  readonly commands: readonly AppInspectionCommandV1[];
  readonly surfaces: readonly AppInspectionSurfaceV1[];
}

export function enumerateAppDescriptorV1(descriptor: unknown): AppDescriptorInspectionV1;
