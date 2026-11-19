/** modules/auth: sign-up, sign-in, sessions, passwords, invites, phone verification, account status. */
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../container';
import { registerPhoneOtpCommands } from './phone-otp';
import { registerAuthRoutes } from './routes';
import { registerSessionRoutes } from './sessions-admin';
import { registerStaffCommands, registerStaffRoutes } from './staff';
import { registerSupplierUserCommands } from './supplier-users';
import { registerUserRoutes } from './users.routes';

export function register(app: FastifyInstance, _deps: Deps): void {
  registerAuthRoutes(app);
  registerSessionRoutes(app);
  registerUserRoutes(app);
  registerStaffRoutes(app);
  registerStaffCommands();
  registerSupplierUserCommands();
  registerPhoneOtpCommands();
}
