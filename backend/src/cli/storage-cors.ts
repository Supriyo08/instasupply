/** `storage-cors` (docs/PLATFORM.md §2.6, §10.1): puts the bucket's CORS rule, built from CORS_ORIGINS. */
import type { Config } from '../config/env';
import { createStorage } from '../platform/storage/storage';

export async function runStorageCors(config: Config): Promise<number> {
  if (config.STORAGE_DRIVER !== 's3') {
    console.info('STORAGE_DRIVER is local: the API answers its own CORS, nothing to set.');
    return 0;
  }
  if (config.CORS_ORIGINS.length === 0) {
    console.error('CORS_ORIGINS is empty: name the console origin first.');
    return 1;
  }
  await createStorage(config).setCors(config.CORS_ORIGINS);
  console.info(`Bucket CORS set for: ${config.CORS_ORIGINS.join(', ')}`);
  return 0;
}
