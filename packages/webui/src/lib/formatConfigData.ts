import { Config } from '@/types/config';
import { WebhookObjectSchema } from '../../../shared/configSchema';

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
          const parsed = WebhookObjectSchema.safeParse(e);
          if (parsed.success) {
            return {
              url: parsed.data.url,
              payload: parsed.data.payload ? JSON.stringify(parsed.data.payload) : '',
              headers: parsed.data.headers ? JSON.stringify(parsed.data.headers) : '',
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
