/**
 * modules/commerce (docs/PLATFORM.md §2.1, §5.2, §5.3.5, §9.1): registerCustomer, placeOrder, cancelOrder,
 * GET /orders, and the §9.1 helpers other modules call (loadCheckoutContext, stageMarketplaceOrder,
 * projectOrderAggregate).
 */
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../container';
import { registerCommerceCommands, registerCommerceRoutes } from './routes';

export { loadCheckoutContext, type CheckoutContext, type CheckoutContextInput } from './checkout-context';
export type { CatalogPlanLine, CustomPlanLine, PlanLine } from './checkout';
export {
  stageMarketplaceOrder,
  stagedFromOrder,
  toPlaceOrderResponse,
  type MarketplaceOrderPlan,
  type OrderPlacer,
  type PlanPayment,
  type StagedOrder,
} from './order-writer';
export { checkAutomaticRefunds, projectOrderAggregate } from './order-aggregate';

export function register(app: FastifyInstance, _deps: Deps): void {
  registerCommerceCommands();
  registerCommerceRoutes(app);
}
