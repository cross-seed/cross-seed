import { createFileRoute } from '@tanstack/react-router';
import { withForm } from '@/hooks/form';
import { useEffect, useState } from 'react';
import { FieldInfo } from '@/components/Form/FieldInfo';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import useConfigForm from '@/hooks/use-config-form';
import { formOpts } from '@/components/Form/shared-form';
import { useAppForm } from '@/hooks/form';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc';
import { formatConfigDataForForm } from '@/lib/formatConfigData';
import { useSaveConfigHook } from '@/hooks/saveFormHook';
import { removeEmptyArrayValues } from '@/lib/transformers';
import { connectValidationSchema } from '@/types/config';
import { FormValidationProvider } from '@/contexts/Form/form-validation-provider';
import { pickSchemaFields } from '@/lib/pick-schema-fields';
import { toast } from 'sonner';
import { SettingsLayout } from '@/components/SettingsLayout';
import { Page } from '@/components/Page';

const ConnectSettings = withForm({
  ...formOpts,
  render: function Render() {
    const { isFieldRequired } = useConfigForm(connectValidationSchema);

    const trpc = useTRPC();
    const {
      data: configData,
    } = useQuery(
      trpc.settings.get.queryOptions(undefined, {
        select: (data) => {
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

    const {
      saveConfig,
      isSuccess,
    } = useSaveConfigHook();

    const form = useAppForm({
      ...formOpts,
      defaultValues: configData ?? formOpts.defaultValues,
      onSubmit: async ({ value }) => {
        try {
          const result = connectValidationSchema.safeParse(value);
          if (!result.success) {
            console.error('FULL VALIDATION FAILED:', result.error.format());
          } else {
            Object.keys(value).forEach((attr) => {
              const val = value[attr as keyof typeof configData];
              if (val && Array.isArray(val)) {
                value[attr as keyof typeof configData] =
                  removeEmptyArrayValues(val);
              }
            });

            saveConfig(value);
          }
        } catch (err) {
          console.error('Exception during full validation:', err);
          return {
            status: 'error',
            error: { _form: 'An unexpected error occurred during validation' },
          };
        }
      },
      validators: {
        onSubmit: connectValidationSchema,
      },
    });

    const [lastFieldAdded, setLastFieldAdded] = useState<string | null>(null);
    useEffect(() => {
      if (lastFieldAdded) {
        const el = document.getElementById(lastFieldAdded);
        el?.focus();
        setLastFieldAdded(null);
      }
    }, [lastFieldAdded]);

    useEffect(() => {
      if (isSuccess) {
          toast.success('Configuration saved successfully!', {
            description: 'Your changes will take effect on the next restart.',
          });
      }
    }, [isSuccess]);

    return (
      <Page>
        <SettingsLayout>
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
            <fieldset className="form-fieldset border-border w-full gap-6 rounded-md border">
              <legend>Connect to Cross Seed</legend>
              <div>
                <form.AppField
                  name="host"
                  validators={{
                  }}
                >
                  {(field) => <field.TextField label="Host" />}
                </form.AppField>
              </div>
              <div className="">
                <form.AppField
                  name="port"
                  validators={{
                  }}
                >
                  {(field) => <field.TextField label="Port" type="number" />}
                </form.AppField>
              </div>
              <div className="">
                <form.AppField
                  name="apiKey"
                  validators={{
                  }}
                >
                  {(field) => <field.TextField label="API Key" />}
                </form.AppField>
              </div>
            </fieldset>
            <fieldset className="form-fieldset border-border w-full gap-6 rounded-md border">
              <legend>Connect to Other Apps</legend>
              <div className="">
                <form.Field
                  name="sonarr"
                  mode="array"
                  validators={{
                  }}
                >
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
                          field.state.value.map((_: string, index: number) => {
                            return (
                              <div
                                key={index}
                                className="gap-y- mb-3 flex flex-col"
                              >
                                <form.AppField
                                  name={`sonarr[${index}]`}
                                  validators={{
                                    onBlur: z.string().url().or(z.literal('')),
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
                          })}
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
                  name="radarr"
                  mode="array"
                  validators={{
                  }}
                >
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
                          field.state.value.map((_: string, index: number) => {
                            return (
                              <div
                                key={index}
                                className="gap-y- mb-3 flex flex-col"
                              >
                                <form.AppField
                                  name={`radarr[${index}]`}
                                  validators={{
                                    onBlur: z.string().url().or(z.literal('')),
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
                          })}
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
              <div className="">
                <form.Field
                  name="notificationWebhookUrls"
                  mode="array"
                  validators={{
                  }}
                >
                  {(field) => {
                    return (
                      <div className="space-y-3">
                        <Label htmlFor={field.name} className="block w-full">
                          Notification Webhook URL(s)
                          {isFieldRequired(field.name) && (
                            <span className="pl-1 text-red-500">*</span>
                          )}
                        </Label>
                        {field.state.value?.map((_: string, index: number) => {
                          return (
                            <div
                              key={index}
                              className="gap-y- mb-3 flex flex-col"
                            >
                              <form.AppField
                                name={`notificationWebhookUrls[${index}]`}
                                validators={{
                                  onBlur: z
                                    .string()
                                    .min(3)
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
                        })}
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
            </fieldset>
            <form.AppForm>
              <form.SubmitButton />
            </form.AppForm>
          </div>
        </form>
        </FormValidationProvider>
        </SettingsLayout>
      </Page>
    );
  },
});

export const Route = createFileRoute('/settings/connect')({
  component: ConnectSettings,
});
