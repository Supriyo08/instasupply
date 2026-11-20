/**
 * Which store-order actions carry the short-ship quantities (MARKETPLACE §2.1.1): Accept, Mark ready and
 * Confirm collection. "Start preparing" and "Not ready after all" do not, so the quantities typed in the
 * pick list must survive them and go with the next action that does.
 */
export function actionSendsAdjustments(action: { kind: string; status?: string }): boolean {
  if (action.kind === 'accept' || action.kind === 'pickup') return true;
  return action.kind === 'status' && action.status === 'ready';
}
