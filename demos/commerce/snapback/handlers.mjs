const MONEY_EXPONENTS = Object.freeze({ USD: 2 });
const MAX_QUANTITY = 10;
const RESERVATION_MS = 15 * 60 * 1_000;

function fail(code, message) {
  throw new Error(code + ': ' + message);
}

function requiredKey(value, label) {
  const normalized = String(value ?? '').trim();
  if (normalized.length === 0 || normalized.length > 100) {
    fail('SNAPBACK_COMMERCE_INPUT_INVALID', label + ' must contain 1–100 characters');
  }
  return normalized;
}

function exactMoney(currency, exponent, unitMinorUnits, quantity) {
  if (!Object.hasOwn(MONEY_EXPONENTS, currency)) {
    fail('SNAPBACK_COMMERCE_CURRENCY_UNSUPPORTED', 'currency is not in the local committed registry');
  }
  if (exponent !== MONEY_EXPONENTS[currency]) {
    fail('SNAPBACK_COMMERCE_MONEY_EXPONENT_INVALID', 'currency exponent does not match the registry');
  }
  if (!Number.isSafeInteger(unitMinorUnits) || unitMinorUnits < 0) {
    fail('SNAPBACK_COMMERCE_MONEY_INVALID', 'minor units must be a nonnegative safe integer');
  }
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    fail('SNAPBACK_COMMERCE_QUANTITY_INVALID', 'quantity is outside the local admitted bound');
  }
  if (unitMinorUnits > Math.floor(Number.MAX_SAFE_INTEGER / quantity)) {
    fail('SNAPBACK_COMMERCE_MONEY_OVERFLOW', 'line total exceeds the exact local integer domain');
  }
  return {
    currency,
    exponent,
    unitMinorUnits,
    quantity,
    totalMinorUnits: unitMinorUnits * quantity,
  };
}

async function findOwnedOrder(ctx, orderId) {
  const order = await ctx.db.get('orders', orderId);
  if (order === null || order.ownerId !== ctx.auth.userId) {
    fail('SNAPBACK_COMMERCE_ORDER_NOT_FOUND', 'order is not visible');
  }
  return order;
}

async function orderLines(ctx, orderId) {
  return await ctx.db
    .query('orderLines')
    .withIndex('by_owner_order')
    .eq('ownerId', ctx.auth.userId)
    .eq('orderId', orderId)
    .collect();
}

async function attemptForOrder(ctx, orderId) {
  const rows = await ctx.db
    .query('paymentAttempts')
    .withIndex('by_order')
    .eq('orderId', orderId)
    .collect();
  return rows[0] ?? null;
}

// @ref LLP 0069#data-model — order lines retain the exact price/version facts
// used at creation; a later product change cannot rewrite checkout money.
async function createOrder(ctx, args) {
  const clientOrderKey = requiredKey(args.clientOrderKey, 'clientOrderKey');
  const prior = await ctx.db
    .query('orders')
    .withIndex('by_owner_client_key')
    .eq('ownerId', ctx.auth.userId)
    .eq('clientOrderKey', clientOrderKey)
    .collect();
  if (prior.length === 1) {
    const lines = await orderLines(ctx, prior[0]._id);
    if (lines.length !== 1
      || lines[0].productId !== args.productId
      || lines[0].quantity !== args.quantity) {
      fail(
        'SNAPBACK_COMMERCE_ORDER_KEY_REUSED',
        'one client order key cannot identify different canonical order bytes',
      );
    }
    return {
      orderId: prior[0]._id,
      replayed: true,
      totalMinorUnits: prior[0].totalMinorUnits,
    };
  }

  const product = await ctx.db.get('products', args.productId);
  if (product === null || product.listed !== true) {
    fail('SNAPBACK_COMMERCE_PRODUCT_NOT_FOUND', 'product is not available');
  }
  const money = exactMoney(
    product.currency,
    product.exponent,
    product.unitMinorUnits,
    args.quantity,
  );
  const orderId = await ctx.db.insert('orders', {
    ownerId: ctx.auth.userId,
    clientOrderKey,
    state: 'draft',
    currency: money.currency,
    exponent: money.exponent,
    totalMinorUnits: money.totalMinorUnits,
    createdAt: ctx.runtime.now(),
  });
  await ctx.db.insert('orderLines', {
    ownerId: ctx.auth.userId,
    orderId,
    productId: product._id,
    productSlug: product.slug,
    productName: product.name,
    priceVersion: product.priceVersion,
    currency: money.currency,
    exponent: money.exponent,
    unitMinorUnits: money.unitMinorUnits,
    quantity: money.quantity,
    lineMinorUnits: money.totalMinorUnits,
  });
  return { orderId, replayed: false, totalMinorUnits: money.totalMinorUnits };
}

// @ref LLP 0069#generated-application-surface — inventory reservation and the
// first immutable payment intent are one Snapback commit, before provider I/O.
async function beginCheckout(ctx, args) {
  const order = await findOwnedOrder(ctx, args.orderId);
  const priorAttempt = await attemptForOrder(ctx, order._id);
  if (priorAttempt !== null) {
    return {
      attemptId: priorAttempt._id,
      replayed: true,
      providerCallAdmitted: priorAttempt.providerCallAdmitted,
    };
  }
  if (order.state !== 'draft') {
    fail('SNAPBACK_COMMERCE_ORDER_STATE_INVALID', 'only a draft order may begin checkout');
  }
  const lines = await orderLines(ctx, order._id);
  if (lines.length !== 1) {
    fail('SNAPBACK_COMMERCE_ORDER_SHAPE_INVALID', 'the exploratory profile requires one order line');
  }
  const line = lines[0];
  const money = exactMoney(
    line.currency,
    line.exponent,
    line.unitMinorUnits,
    line.quantity,
  );
  if (money.totalMinorUnits !== line.lineMinorUnits
    || money.totalMinorUnits !== order.totalMinorUnits
    || money.currency !== order.currency
    || money.exponent !== order.exponent) {
    fail('SNAPBACK_COMMERCE_ORDER_MONEY_MISMATCH', 'immutable order money facts disagree');
  }

  const product = await ctx.db.get('products', line.productId);
  if (product === null) {
    fail('SNAPBACK_COMMERCE_PRODUCT_NOT_FOUND', 'inventory product is missing');
  }
  if (!Number.isSafeInteger(product.availableUnits)
    || product.availableUnits < line.quantity) {
    fail('SNAPBACK_COMMERCE_INVENTORY_UNAVAILABLE', 'insufficient inventory');
  }

  const now = ctx.runtime.now();
  const attemptKey = ctx.runtime.id();
  const attemptId = await ctx.db.insert('paymentAttempts', {
    attemptKey,
    ownerId: ctx.auth.userId,
    orderId: order._id,
    state: 'intentRecorded',
    currency: money.currency,
    exponent: money.exponent,
    minorUnits: money.totalMinorUnits,
    providerProfile: 'unconfigured-exploratory',
    providerCommandKey: 'attempt:' + attemptKey + ':authorize-capture:1',
    providerCallAdmitted: false,
    createdAt: now,
  });
  await ctx.db.insert('reservations', {
    ownerId: ctx.auth.userId,
    orderId: order._id,
    attemptId,
    productId: product._id,
    quantity: line.quantity,
    state: 'active',
    providerRequestMayHaveArrived: false,
    expiresAt: now + RESERVATION_MS,
  });
  await ctx.db.patch('products', product._id, {
    availableUnits: product.availableUnits - line.quantity,
  });
  await ctx.db.patch('orders', order._id, {
    state: 'reserved',
    attemptId,
  });
  return { attemptId, replayed: false, providerCallAdmitted: false };
}

globalThis.__snapbackHandlers = {
  createOrder,
  beginCheckout,
};
