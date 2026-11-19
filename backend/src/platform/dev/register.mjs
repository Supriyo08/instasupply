// `--import ./src/platform/dev/register.mjs`: installs the hooks of shared-esm.mjs (development and tests only).
import { register } from 'node:module';

register('./shared-esm.mjs', import.meta.url);
