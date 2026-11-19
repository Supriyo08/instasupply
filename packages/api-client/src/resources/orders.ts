import { seg } from './context';

/** Orders and store orders (PLATFORM §5.3.5). Reads only: every order change is a command. */
export const orderPaths = {
  orders: '/orders',
  order: (orderId: string) => `/orders/${seg(orderId)}`,
  storeOrders: '/store-orders',
  storeOrder: (id: string) => `/store-orders/${seg(id)}`,
  storeOrderPrivate: (id: string) => `/store-orders/${seg(id)}/private`,
  storeOrderProof: (id: string) => `/store-orders/${seg(id)}/proof`,
} as const;
