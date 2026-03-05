import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, TestTube } from 'lucide-react';
import { FieldInfo } from '@/components/Form/FieldInfo';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import DeleteOption from '@/components/Buttons/DeleteOption';
import useConfigForm from '@/hooks/use-config-form';
import { defaultConnectFormValues } from '@/components/Form/shared-form';
import { useAppForm } from '@/hooks/form';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc';
import { formatConfigDataForForm } from '@/lib/formatConfigData';
import { connectValidationSchema } from '@/types/config';
import { FormValidationProvider } from '@/contexts/Form/form-validation-provider';
import { pickSchemaFields } from '@/lib/pick-schema-fields';
import { Page } from '@/components/Page';
import { useSettingsFormSubmit } from '@/hooks/use-settings-form-submit';
import { RuntimeConfig } from '../../../../shared/configSchema';

type ConnectFormData = z.infer<typeof connectValidationSchema>;

type WebhookFormEntry = { url: string; payload: string; headers: string };

function transformWebhooksForApi(
  entries: WebhookFormEntry[],
): (string | { url: string; payload?: Record<string, unknown>; headers?: Record<string, string> })[] {
  return entries
    .filter((e) => e.url !== '')
    .map((e) => {
      if (!e.payload && !e.headers) return e.url;
      const obj: { url: string; payload?: unknown; headers?: unknown } = { url: e.url };
      if (e.payload) obj.payload = JSON.parse(e.payload);
      if (e.headers) obj.headers = JSON.parse(e.headers);
      return obj;
    });
}

function ConnectSettings() {
  const { isFieldRequired } = useConfigForm(connectValidationSchema);

  const trpc = useTRPC();
  const { data: configData } = useQuery(
    trpc.settings.get.queryOptions(undefined, {
      select: (data: {
        config: RuntimeConfig;
        apikey: string;
      }): Partial<ConnectFormData> => {
        const fullDataset = formatConfigDataForForm(data.config);
        const filteredData = pickSchemaFields(
          connectValidationSchema,
          fullDataset,
          { includeUndefined: true },
        );

        return filteredData;
      },
    }),
  );

  const baseHandleSubmit = useSettingsFormSubmit();
  const handleSubmit = useCallback(
    async ({ value }: { value: ConnectFormData }) => {
      const transformed = {
        ...value,
        notificationWebhookUrls: transformWebhooksForApi(
          value.notificationWebhookUrls as WebhookFormEntry[],
        ),
      };
      return baseHandleSubmit({ value: transformed });
    },
    [baseHandleSubmit],
  );

  const form = useAppForm({
    defaultValues: (configData ?? defaultConnectFormValues) as ConnectFormData,
    onSubmit: handleSubmit,
    validators: {
      onSubmit: connectValidationSchema,
    },
  });

  const [isTesting, setIsTesting] = useState(false);
  const { mutate: testWebhooks } = useMutation(
    trpc.settings.testNotification.mutationOptions({
      onSuccess: () => {
        setIsTesting(false);
        toast.success('Test notification sent!');
      },
      onError: (error) => {
        setIsTesting(false);
        toast.error(`Test failed: ${error.message}`);
      },
    }),
  );

  const [lastFieldAdded, setLastFieldAdded] = useState<string | null>(null);
  useEffect(() => {
    if (lastFieldAdded) {
      const el = document.getElementById(lastFieldAdded);
      el?.focus();
      setLastFieldAdded(null);
    }
  }, [lastFieldAdded]);

  return (
    <Page>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Connected App Settings</h1>
          <p className="text-muted-foreground">
            Manage apps connected to Cross-seed.
          </p>
        </div>
        <FormValidationProvider isFieldRequired={isFieldRequired}>
          <form
            className="form flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
            noValidate
          >
            <div className="flex flex-wrap gap-6">
              <fieldset className="form-fieldset w-full gap-6">
                <div>
                  <form.AppField name="host" validators={{}}>
                    {(field) => <field.TextField label="Host" />}
                  </form.AppField>
                </div>
                <div className="">
                  <form.AppField name="port" validators={{}}>
                    {(field) => <field.NumberField label="port" />}
                  </form.AppField>
                </div>
                <div>
                  <form.AppField name="apikey" validators={{}}>
                    {(field) => <field.TextField label="API Key" />}
                  </form.AppField>
                </div>
              </fieldset>
              <fieldset className="form-fieldset border-border w-full gap-6 rounded-md border">
                <legend>Connect to Other Apps</legend>
                <div className="">
                  <form.Field name="sonarr" mode="array" validators={{}}>
                    {(field) => {
                      return (
                        <div className="space-y-3">
                          <Label htmlFor={field.name} className="block w-full">
                            Sonarr URL(s)
                            {isFieldRequired(field.name) && (
                              <span className="pl-1 text-red-500">*</span>
                            )}
                          </Label>
                          {field.state.value &&
                            field.state.value.map(
                              (_: string, index: number) => {
                                return (
                                  <div
                                    key={index}
                                    className="gap-y- mb-3 flex flex-col"
                                  >
                                    <form.AppField
                                      name={`sonarr[${index}]`}
                                      validators={{
                                        onBlur: z
                                          .string()
                                          .url()
                                          .or(z.literal('')),
                                      }}
                                    >
                                      {(subfield) => (
                                        <subfield.ArrayField
                                          showDelete={
                                            field.state.value &&
                                            field.state.value?.length > 1
                                          }
                                          index={index}
                                          onDelete={() => {
                                            field.removeValue(index);
                                          }}
                                        />
                                      )}
                                    </form.AppField>
                                    <form.Subscribe
                                      selector={(f) =>
                                        f.fieldMeta[
                                          `${field.name}[${index}]` as keyof typeof f.fieldMeta
                                        ]
                                      }
                                    >
                                      {(fieldMeta) => (
                                        <FieldInfo fieldMeta={fieldMeta} />
                                      )}
                                    </form.Subscribe>
                                  </div>
                                );
                              },
                            )}
                          <Button
                            variant="secondary"
                            type="button"
                            onClick={() => {
                              field.pushValue('');
                              const newFieldId = `${field.name}-${field.state.value?.length ? field.state.value.length - 1 : 0}`;
                              setLastFieldAdded(newFieldId);
                            }}
                            title={`Add ${field.name}`}
                          >
                            Add
                          </Button>
                        </div>
                      );
                    }}
                  </form.Field>
                </div>
                <div>
                  <form.Field name="radarr" mode="array" validators={{}}>
                    {(field) => {
                      return (
                        <div className="space-y-3">
                          <Label htmlFor={field.name} className="block w-full">
                            Radarr URL(s)
                            {isFieldRequired(field.name) && (
                              <span className="pl-1 text-red-500">*</span>
                            )}
                          </Label>
                          {field.state.value &&
                            field.state.value.map(
                              (_: string, index: number) => {
                                return (
                                  <div
                                    key={index}
                                    className="gap-y- mb-3 flex flex-col"
                                  >
                                    <form.AppField
                                      name={`radarr[${index}]`}
                                      validators={{
                                        onBlur: z
                                          .string()
                                          .url()
                                          .or(z.literal('')),
                                      }}
                                    >
                                      {(subfield) => (
                                        <subfield.ArrayField
                                          showDelete={
                                            field.state.value &&
                                            field.state.value?.length > 1
                                          }
                                          index={index}
                                          onDelete={() => {
                                            field.removeValue(index);
                                          }}
                                        />
                                      )}
                                    </form.AppField>
                                    <form.Subscribe
                                      selector={(f) =>
                                        f.fieldMeta[
                                          `${field.name}[${index}]` as keyof typeof f.fieldMeta
                                        ]
                                      }
                                    >
                                      {(fieldMeta) => (
                                        <FieldInfo fieldMeta={fieldMeta} />
                                      )}
                                    </form.Subscribe>
                                  </div>
                                );
                              },
                            )}
                          <Button
                            variant="secondary"
                            type="button"
                            onClick={() => {
                              field.pushValue('');
                              const newFieldId = `${field.name}-${field.state.value?.length ? field.state.value.length - 1 : 0}`;
                              setLastFieldAdded(newFieldId);
                            }}
                            title={`Add ${field.name}`}
                          >
                            Add
                          </Button>
                        </div>
                      );
                    }}
                  </form.Field>
                </div>
                <div>
                  <form.Field
                    name="notificationWebhookUrls"
                    mode="array"
                    validators={{}}
                  >
                    {(field) => {
                      return (
                        <div className="space-y-3">
                          <Label htmlFor={field.name} className="block w-full">
                            Notification Webhook(s)
                            {isFieldRequired(field.name) && (
                              <span className="pl-1 text-red-500">*</span>
                            )}
                          </Label>
                          {field.state.value?.map(
                            (_: WebhookFormEntry, index: number) => (
                              <fieldset
                                key={index}
                                className="border-border space-y-2 rounded-md border p-3"
                              >
                                <div className="flex items-center gap-2">
                                  <form.Field
                                    name={`notificationWebhookUrls[${index}].url`}
                                    validators={{
                                      onBlur: z.string().url().or(z.literal('')),
                                    }}
                                  >
                                    {(subfield) => (
                                      <Input
                                        id={`notificationWebhookUrls-${index}-url`}
                                        name={subfield.name}
                                        value={subfield.state.value}
                                        onChange={(e) =>
                                          subfield.handleChange(e.target.value)
                                        }
                                        onBlur={subfield.handleBlur}
                                        placeholder="https://example.com/webhook"
                                        className="flex-1"
                                      />
                                    )}
                                  </form.Field>
                                  {(field.state.value?.length ?? 0) > 1 && (
                                    <DeleteOption
                                      onClick={() => field.removeValue(index)}
                                    />
                                  )}
                                </div>
                                <form.Subscribe
                                  selector={(f) =>
                                    f.fieldMeta[
                                      `notificationWebhookUrls[${index}].url` as keyof typeof f.fieldMeta
                                    ]
                                  }
                                >
                                  {(fieldMeta) => (
                                    <FieldInfo fieldMeta={fieldMeta} />
                                  )}
                                </form.Subscribe>
                                <details className="mt-1" open={!!(_.headers || _.payload)}>
                                  <summary className="text-muted-foreground cursor-pointer text-xs select-none">
                                    Advanced (custom headers &amp; payload)
                                  </summary>
                                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                  <div>
                                    <Label className="text-muted-foreground text-xs">
                                      Headers (JSON)
                                    </Label>
                                    <form.Field
                                      name={`notificationWebhookUrls[${index}].headers`}
                                    >
                                      {(subfield) => (
                                        <Textarea
                                          name={subfield.name}
                                          value={subfield.state.value}
                                          onChange={(e) =>
                                            subfield.handleChange(
                                              e.target.value,
                                            )
                                          }
                                          onBlur={subfield.handleBlur}
                                          placeholder='{"Authorization": "Bearer token"}'
                                          rows={2}
                                          className="resize-y font-mono text-xs"
                                        />
                                      )}
                                    </form.Field>
                                    <form.Subscribe
                                      selector={(f) =>
                                        f.fieldMeta[
                                          `notificationWebhookUrls[${index}].headers` as keyof typeof f.fieldMeta
                                        ]
                                      }
                                    >
                                      {(fieldMeta) => (
                                        <FieldInfo fieldMeta={fieldMeta} />
                                      )}
                                    </form.Subscribe>
                                  </div>
                                  <div>
                                    <Label className="text-muted-foreground text-xs">
                                      Payload (JSON)
                                    </Label>
                                    <form.Field
                                      name={`notificationWebhookUrls[${index}].payload`}
                                    >
                                      {(subfield) => (
                                        <Textarea
                                          name={subfield.name}
                                          value={subfield.state.value}
                                          onChange={(e) =>
                                            subfield.handleChange(
                                              e.target.value,
                                            )
                                          }
                                          onBlur={subfield.handleBlur}
                                          placeholder='{"topic": "cross-seed"}'
                                          rows={2}
                                          className="resize-y font-mono text-xs"
                                        />
                                      )}
                                    </form.Field>
                                    <form.Subscribe
                                      selector={(f) =>
                                        f.fieldMeta[
                                          `notificationWebhookUrls[${index}].payload` as keyof typeof f.fieldMeta
                                        ]
                                      }
                                    >
                                      {(fieldMeta) => (
                                        <FieldInfo fieldMeta={fieldMeta} />
                                      )}
                                    </form.Subscribe>
                                  </div>
                                </div>
                                </details>
                              </fieldset>
                            ),
                          )}
                          <div className="flex gap-2">
                            <Button
                              variant="secondary"
                              type="button"
                              onClick={() => {
                                field.pushValue({
                                  url: '',
                                  payload: '',
                                  headers: '',
                                });
                                setLastFieldAdded(
                                  `notificationWebhookUrls-${field.state.value?.length ?? 0}-url`,
                                );
                              }}
                              title="Add webhook"
                            >
                              Add
                            </Button>
                            <Button
                              variant="secondary"
                              type="button"
                              disabled={isTesting || !field.state.value?.some((e) => e.url)}
                              onClick={() => {
                                setIsTesting(true);
                                testWebhooks({});
                              }}
                              title="Test all saved webhooks"
                            >
                              {isTesting ? (
                                <>
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  Testing…
                                </>
                              ) : (
                                <>
                                  <TestTube className="h-4 w-4" />
                                  Test Webhooks
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      );
                    }}
                  </form.Field>
                </div>
              </fieldset>
              <form.AppForm>
                <form.SubmitButton />
              </form.AppForm>
            </div>
          </form>
        </FormValidationProvider>
      </div>
    </Page>
  );
}

export const Route = createFileRoute('/settings/connect')({
  component: ConnectSettings,
});
