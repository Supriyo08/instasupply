import { customerQueries } from './customer';
import { driverQueries } from './driver';
import { opsQueries } from './ops';
import { publicQueries } from './public';
import { supplierQueries } from './supplier';

/**
 * The single place for query keys (CLIENTS §4.1). Every factory accepts `undefined` for an id and then
 * returns a disabled descriptor, so a screen can call it before its route parameter is known.
 */
export const queries = {
  ...publicQueries,
  ...customerQueries,
  ...supplierQueries,
  ...driverQueries,
  ...opsQueries,
};

export type Queries = typeof queries;

export { ORDER_STATES, type OrderState } from './customer';
export type { ProductSearchParams, StoreProductsParams } from './public';
export type { LedgerFilters, PayeeType } from './supplier';
export type { Filters } from './ops';
