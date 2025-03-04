import { Config } from '@/types/config';
import ms from 'ms';

/**
 * Formats the provided configuration data into a format suitable for the configuration form.
 *
 * This function takes a `Config` object and returns a modified `Config` object
 * that is optimized for use in a configuration form. The main changes are:
 *
 * - Any empty array fields are converted to have a single empty string value, so the form fields will show up.
 * - Numeric fields representing durations in milliseconds are converted to human-readable relative time strings.
 *
 * @param config - The configuration data to format.
 * @returns The formatted configuration data suitable for a configuration form.
 */
export function formatConfigDataForForm(config: Config) {
  return {
    ...config,

    // Update empty array fields to have an empty string so the form
    // fields show
    dataDirs: config.dataDirs.length ? config.dataDirs : [''],
    linkDirs: config.linkDirs.length ? config.linkDirs : [''],
    torznab: config.torznab.length ? config.torznab : [''],
    sonarr: config.sonarr.length ? config.sonarr : [''],
    radarr: config.radarr.length ? config.radarr : [''],
    notificationWebhookUrls: config.notificationWebhookUrls.length
      ? config.notificationWebhookUrls
      : [''],
    blockList: config.blockList?.length ? config.blockList : [''],
    excludeOlder: convertNumberToRelativeTime(Number(config.excludeOlder)),
    excludeRecentSearch: convertNumberToRelativeTime(
      Number(config.excludeRecentSearch),
    ),
    rssCadence: convertNumberToRelativeTime(Number(config.rssCadence)),
    searchCadence: convertNumberToRelativeTime(Number(config.searchCadence)),
    snatchTimeout: convertNumberToRelativeTime(Number(config.snatchTimeout)),
    searchTimeout: convertNumberToRelativeTime(Number(config.searchTimeout)),
  };
}

/**
 * Converts a number representing a duration in milliseconds to a human-readable relative time string.
 *
 * @param value - The number of milliseconds to convert.
 * @returns A human-readable relative time string (e.g. "1 minute", "2 hours", "3 days").
 */
export function convertNumberToRelativeTime(value: number) {
  return ms(value, { long: true });
}
