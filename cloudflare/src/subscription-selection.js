// @ref LLP 0007#index-contract — fan-out must select the affected durable
// subscription slice through the internal function-name index, never by
// materializing the whole registry in JavaScript.
export const SUBSCRIPTION_FUNCTION_INDEX = 'idx_snapback_subscriptions_function';

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
