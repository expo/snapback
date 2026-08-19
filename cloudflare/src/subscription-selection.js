// @ref LLP 0007#index-contract — fan-out must select the affected durable
// subscription slice through the internal function-name index, never by
// materializing the whole registry in JavaScript.
export const SUBSCRIPTION_FUNCTION_INDEX = 'idx_snapback_subscriptions_function';
export const SUBSCRIPTION_SELECTION_MAX_FUNCTIONS = 500;

// Single source for the production fan-out selector and its deterministic
// scaling acceptance. Keeping the SQL here lets the acceptance inspect the
// exact production query without adding a test route to deployed Workers.
export function compileSubscriptionSelection(functionNames) {
  const params = [...functionNames].map((name) => String(name));
  if (params.length === 0) {
    throw new Error('subscription selection requires at least one function');
  }
  const placeholders = params.map(() => '?').join(', ');
  return {
    sql: `SELECT * FROM _snapback_subscriptions WHERE function_name IN (${placeholders})`,
    params,
  };
}

// Conservative fan-out can consider every live function in a deployment.
// Keep each indexed selector within the same 500-binding portability ceiling
// as application query filters instead of assuming the manifest is smaller
// than the engine's statement-variable limit.
export function compileSubscriptionSelections(functionNames) {
  const names = [...functionNames].map((name) => String(name));
  if (names.length === 0) {
    throw new Error('subscription selection requires at least one function');
  }
  const selections = [];
  for (let offset = 0; offset < names.length; offset += SUBSCRIPTION_SELECTION_MAX_FUNCTIONS) {
    selections.push(
      compileSubscriptionSelection(names.slice(offset, offset + SUBSCRIPTION_SELECTION_MAX_FUNCTIONS))
    );
  }
  return selections;
}
