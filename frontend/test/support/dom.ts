// Imported first by component tests: ES imports run in order, so the DOM exists before
// @testing-library/react loads and binds `screen` to document.body.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();
// React checks this flag to know that `act` is in use.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export async function unregisterDom(): Promise<void> {
  await GlobalRegistrator.unregister();
}
