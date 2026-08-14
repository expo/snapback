import type {
  DataClientV1,
  DataDiagnosticV1,
  DataPageV1,
  DataQueryStateV1,
  DataTransactionHandleV1,
  DataWatchHandleV1,
} from '@expo/snapback-client/data';

export interface SnapbackDataBinding {}

type GeneratedData = SnapbackDataBinding extends { readonly data: infer Data }
  ? Data
  : Readonly<Record<string, never>>;
type GeneratedTransactionBuilder = GeneratedData extends {
  readonly __snapbackDataTypeBinding?: Readonly<{ readonly tx: infer Builder }>;
} ? Builder : Readonly<Record<string, Readonly<Record<string, (...args: never[]) => never>>>>;
type DescriptorResult<Descriptor> = Descriptor extends { readonly __result?: infer Result }
  ? DataPageV1<Result>
  : DataPageV1;

export type {
  DataDiagnosticV1,
  DataQueryStateV1,
  DataTransactionHandleV1,
  DataWatchHandleV1,
};

type ProviderBoundDataClientV1 = DataClientV1<GeneratedTransactionBuilder>
  & GeneratedData
  & Readonly<{
    useQuery<const Descriptor>(descriptor: Descriptor | 'skip'):
      Descriptor extends 'skip'
        ? Extract<DataQueryStateV1<never>, { status: 'skipped' }>
        : DataQueryStateV1<DescriptorResult<Descriptor>>;
  }>;

export declare const db: ProviderBoundDataClientV1;
