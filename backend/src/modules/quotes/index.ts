/**
 * modules/quotes (docs/PLATFORM.md §2.1, §5.2, §5.3.7, §9.2.10, §9.5; owner `quotes-issues`, §15.2): material
 * lists, the quote builder's offers, accepting an offer into an order, closing, reopening, the private
 * workspace, and the `expireQuotes` job. It owns no §9.1 helper.
 */
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../container';
import { registerJob } from '../../platform/scheduler/registry';
import { runExpireQuotes } from './expire-quotes';
import { registerQuoteCommands, registerQuoteRoutes } from './routes';

export { runExpireQuotes } from './expire-quotes';

export function register(app: FastifyInstance, _deps: Deps): void {
  registerQuoteCommands();
  registerQuoteRoutes(app);
  registerJob({ name: 'expireQuotes', schedule: { everyMs: 15 * 60_000 }, run: runExpireQuotes });
}
