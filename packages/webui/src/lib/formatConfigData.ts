import { Config } from '@/types/config';

/**
 * Currently acts as an identity function—kept around as a dedicated hook
 * point in case the UI needs one-off tweaks to API data in the future.
 */
export function formatConfigDataForForm(config: Config) {
  return config;
  //  return {
  //    ...config,

  // Update empty array fields to have an empty string so the form
  // fields show
  //    dataDirs: config.dataDirs?.length ? config.dataDirs : [''],
  //    linkDirs: config.linkDirs.length ? config.linkDirs : [''],
  //    torznab: config.torznab.length ? config.torznab : [''],
  //    sonarr: config.sonarr?.length ? config.sonarr : [''],
  //    radarr: config.radarr?.length ? config.radarr : [''],
  //    notificationWebhookUrls: config.notificationWebhookUrls?.length
  //      ? config.notificationWebhookUrls
  //      : [''],
  //    blockList: config.blockList?.length ? config.blockList : [''],
  //    excludeOlder: convertNumberToRelativeTime(Number(config.excludeOlder)),
  //    excludeRecentSearch: convertNumberToRelativeTime(
  //      Number(config.excludeRecentSearch),
  //    ),
  //    rssCadence: convertNumberToRelativeTime(Number(config.rssCadence)),
  //    searchCadence: convertNumberToRelativeTime(Number(config.searchCadence)),
  //    snatchTimeout: convertNumberToRelativeTime(Number(config.snatchTimeout)),
  //    searchTimeout: convertNumberToRelativeTime(Number(config.searchTimeout)),
  //    torrentClients: config.torrentClients?.length
  //      ? config.torrentClients
  //      : [''],
  //  };
}
