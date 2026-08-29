export declare const RELATIONAL_TAKE_CEILING: 1024;
export declare const SNAPSHOT_BATCH_SUMMED_TAKE_CEILING: 1024;
export declare const SNAPBACK_PUBLIC_BUDGETS_V1: Readonly<{
  query: Readonly<{
    implicitResultRows: 1024;
    takeRows: 1024;
    dynamicTake: 'supported-with-runtime-ceiling';
    repair: 'fixed-bound-then-slice';
  }>;
  result: Readonly<{ maxBytes: 4194304; maxArrayItems: 1024 }>;
  retainedMutationOutput: Readonly<{
    maxBytes: 65536;
    diagnostic: 'SNAPBACK_CLIENT_MUTATION_RESULT_TOO_LARGE';
  }>;
  react: Readonly<{
    queryStores: 256;
    queryConsumers: 1024;
    viewSubscriptionWarning: 16;
    serverSubscriptions: 64;
    warningDiagnostic: 'SNAPBACK_REACT_SUBSCRIPTION_VIEW_BUDGET_EXCEEDED';
  }>;
}>;
