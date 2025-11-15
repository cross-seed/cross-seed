import { Config } from '@/types/config';

/**
 * Formats the provided configuration data into a format suitable for the configuration form.
 *
 * This function takes a `Config` object and returns a modified `Config` object
 * that is optimized for use in a configuration form. The main changes are:
 *
 * - Any empty array fields are converted to have a single empty string value, so the form fields will show up.
 *
 * @param config - The configuration data to format.
 * @returns The formatted configuration data suitable for a configuration form.
 */
export function formatConfigDataForForm(config: Config) {
  return {
    ...config,

    // Update empty array fields to have an empty string so the form
    // fields show
    dataDirs: config.dataDirs?.length ? config.dataDirs : [''],
    linkDirs: config.linkDirs.length ? config.linkDirs : [''],
    torznab: config.torznab?.length ? config.torznab : [''],
    sonarr: config.sonarr?.length ? config.sonarr : [''],
    radarr: config.radarr?.length ? config.radarr : [''],
    notificationWebhookUrls: config.notificationWebhookUrls?.length
      ? config.notificationWebhookUrls
      : [''],
    blockList: config.blockList?.length ? config.blockList : [''],
  };
}
