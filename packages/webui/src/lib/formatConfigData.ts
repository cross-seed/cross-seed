import { Config } from '@/types/config';

/**
 * Currently acts as an identity function—kept around as a dedicated hook
 * point in case the UI needs one-off tweaks to API data in the future.
 */
export function formatConfigDataForForm(config: Config) {
  return config;
}
