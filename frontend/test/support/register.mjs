// `--import ./test/support/register.mjs` (console tests only): installs the hooks of shared-esm.mjs.
import { register } from 'node:module';

register('./shared-esm.mjs', import.meta.url);
