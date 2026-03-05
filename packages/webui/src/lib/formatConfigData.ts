import { Config } from '@/types/config';

/**
 * Transforms API config data for the WebUI form.
 * Object webhook entries are mapped to their URL string for display.
 */
export function formatConfigDataForForm(config: Config) {
  return {
    ...config,
    ...(config.notificationWebhookUrls && {
      notificationWebhookUrls: config.notificationWebhookUrls.map(
        (e: unknown) => {
          if (typeof e === 'string') {
            return { url: e, payload: '', headers: '' };
          }
          if (typeof e === 'object' && e !== null && 'url' in e) {
            const obj = e as {
              url: string;
              payload?: unknown;
              headers?: unknown;
            };
            return {
              url: obj.url,
              payload: obj.payload ? JSON.stringify(obj.payload) : '',
              headers: obj.headers ? JSON.stringify(obj.headers) : '',
            };
          }
          return { url: '', payload: '', headers: '' };
        },
      ),
    }),
  };
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
