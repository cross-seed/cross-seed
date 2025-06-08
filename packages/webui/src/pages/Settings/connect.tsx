import { withForm } from '@/hooks/form';
import { useEffect, useState } from 'react';
import { FieldInfo } from '@/components/Form/FieldInfo';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import useConfigForm from '@/hooks/use-config-form';
import { formOpts } from '../../components/Form/shared-form';
import { useAppForm } from '@/hooks/form';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc';
import { formatConfigDataForForm } from '@/lib/formatConfigData';
import { useSaveConfigHook } from '@/hooks/saveFormHook';
import { removeEmptyArrayValues } from '@/lib/transformers';
import { connectValidationSchema } from '@/types/config';
import { FormValidationProvider } from '@/contexts/Form/form-validation-provider';

const ConnectSettings = withForm({
  ...formOpts,
  render: function Render() {
    const { isFieldRequired } = useConfigForm(connectValidationSchema);

    const trpc = useTRPC();
    const {
      data: configData,
      // isLoading,
      // isError,
    } = useQuery(
      trpc.settings.get.queryOptions(undefined, {
        select: (data) => formatConfigDataForForm(data.config),
      }),
    );

    const {
      saveConfig,
      // isLoading: isSaving,
      // isError: isSaveError,
    } = useSaveConfigHook();

    const form = useAppForm({
      ...formOpts,
      defaultValues: configData ?? formOpts.defaultValues,
      onSubmit: async ({ value }) => {
        // Full schema validation
        // Fake a long response delay
        // setTimeout(() => {
        try {
          const result = connectValidationSchema.safeParse(value);
          if (!result.success) {
            console.error('FULL VALIDATION FAILED:', result.error.format());
          } else {
            // remove empty values from array fields
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
        // }, 2000);
      },
      validators: {
        onSubmit: connectValidationSchema,
      },
    });

    /**
     * Focus on the newly added field in array fields
     */
    const [lastFieldAdded, setLastFieldAdded] = useState<string | null>(null);
    useEffect(() => {
      if (lastFieldAdded) {
        const el = document.getElementById(lastFieldAdded);
        el?.focus();
        setLastFieldAdded(null);
      }
    }, [lastFieldAdded]);

    return (
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
        {/* form fields */}
        <div className="flex flex-wrap gap-6">
          <fieldset className="form-fieldset border-border w-full gap-6 rounded-md border">
            <legend>Connect to Cross Seed</legend>
            <div>
              <form.AppField
                name="host"
                validators={
                  {
                    // onBlur: validationSchema.shape.host,
                  }
                }
              >
                {(field) => <field.TextField label="Host" />}
              </form.AppField>
            </div>
            <div className="">
              <form.AppField
                name="port"
                validators={
                  {
                    // onBlur: validationSchema.shape.port,
                  }
                }
              >
                {(field) => <field.TextField label="Port" type="number" />}
              </form.AppField>
            </div>
            <div className="">
              <form.AppField
                name="apiKey"
                validators={
                  {
                    // onBlur: validationSchema.shape.apiKey,
                  }
                }
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
                validators={
                  {
                    // onBlur: baseValidationSchema.shape.sonarr,
                    // onChange: baseValidationSchema.shape.sonarr,
                  }
                }
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
                validators={
                  {
                    // onBlur: baseValidationSchema.shape.radarr,
                    // onChange: baseValidationSchema.shape.radarr,
                  }
                }
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
                validators={
                  {
                    // onBlur: baseValidationSchema.shape.notificationWebhookUrls,
                    // onChange: baseValidationSchema.shape.notificationWebhookUrls,
                  }
                }
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
    );
  },
});

export default ConnectSettings;
