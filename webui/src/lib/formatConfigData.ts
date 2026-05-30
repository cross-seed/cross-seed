import {
  RuntimeConfig,
  WebhookEntry,
  WebhookObjectSchema,
} from '@cross-seed/shared/configSchema';

/**
 * Transforms API config data for the WebUI form. Webhook entries are normalized
 * to the form's `{ url, payload, headers, advancedOpen }` shape, with
 * payload/headers serialized back to JSON text for editing in the textareas.
 * `advancedOpen` is seeded from whether the saved entry has any custom
 * headers/payload, so saved-with-data webhooks render expanded.
 */
export function formatConfigDataForForm(config: RuntimeConfig) {
  return {
    ...config,
    ...(config.notificationWebhookUrls && {
      notificationWebhookUrls: config.notificationWebhookUrls.map(
        (e: WebhookEntry) => {
          if (typeof e === 'string') {
            return { url: e, payload: '', headers: '', advancedOpen: false };
          }
          const parsed = WebhookObjectSchema.safeParse(e);
          if (parsed.success) {
            const payload = parsed.data.payload
              ? JSON.stringify(parsed.data.payload)
              : '';
            const headers = parsed.data.headers
              ? JSON.stringify(parsed.data.headers)
              : '';
            return {
              url: parsed.data.url,
              payload,
              headers,
              advancedOpen: Boolean(payload) || Boolean(headers),
            };
          }
          return {
            url: '',
            payload: '',
            headers: '',
            advancedOpen: false,
          };
        },
      ),
    }),
  };
}
