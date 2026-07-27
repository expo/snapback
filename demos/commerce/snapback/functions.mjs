// @ref LLP 0063#next-application-pressure-tests — this is the local,
// claim-ineligible transaction kernel for the Commerce pressure slice.
// @ref LLP 0069#generated-application-surface — beginCheckout accepts only
// orderId; all price, currency, and quantity facts come from durable rows.

import {
  arg,
  asc,
  authUserId,
  defineJsMutation,
  defineLiveQuery,
  eq,
  v,
} from '../../_kit/define.mjs';

export const catalog = defineLiveQuery({
  table: 'products',
  args: {},
  order: [asc('slug')],
  index: 'by_slug',
});

export const myOrders = defineLiveQuery({
  auth: 'authenticated',
  table: 'orders',
  args: {},
  filter: [eq('ownerId', authUserId())],
  order: [asc('createdAt')],
  index: 'by_owner_created',
});

export const myOrderLines = defineLiveQuery({
  auth: 'authenticated',
  table: 'orderLines',
  args: { orderId: v.id('orders') },
  filter: [
    eq('ownerId', authUserId()),
    eq('orderId', arg('orderId')),
  ],
  index: 'by_owner_order',
});

export const myPaymentAttempts = defineLiveQuery({
  auth: 'authenticated',
  table: 'paymentAttempts',
  args: {},
  filter: [eq('ownerId', authUserId())],
  order: [asc('_createdAt')],
  index: 'by_owner',
});

export const myReservations = defineLiveQuery({
  auth: 'authenticated',
  table: 'reservations',
  args: { orderId: v.id('orders') },
  filter: [
    eq('ownerId', authUserId()),
    eq('orderId', arg('orderId')),
  ],
  index: 'by_owner_order',
});

export const createOrder = defineJsMutation({
  auth: 'authenticated',
  args: {
    productId: v.id('products'),
    quantity: v.integer(),
    clientOrderKey: v.string(),
  },
  source: 'handlers.mjs',
  exportName: 'createOrder',
  reads: ['products', 'orders', 'orderLines'],
  writes: ['orders', 'orderLines'],
});

export const beginCheckout = defineJsMutation({
  auth: 'authenticated',
  args: { orderId: v.id('orders') },
  source: 'handlers.mjs',
  exportName: 'beginCheckout',
  reads: ['orders', 'orderLines', 'products', 'paymentAttempts', 'reservations'],
  writes: ['orders', 'products', 'paymentAttempts', 'reservations'],
});
