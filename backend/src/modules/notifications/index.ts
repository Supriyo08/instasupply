/**
 * WAVE-2 PLACEHOLDER written by the platform workstream (docs/PLATFORM.md §15 rule 1). The owner is `money-comms`
 * (§15.2), who replaces the bodies; the exported names and signatures are the frozen ones of §9.1, so other
 * modules compile against them today. Its commands answer internal "not implemented" until the owner registers them with defineCommand.
 */
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../container';
import { defineStubCommand } from '../../platform/http/command';

export function register(_app: FastifyInstance, _deps: Deps): void {
  defineStubCommand('sendTestNotification', 'money-comms');
}
