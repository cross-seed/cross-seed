import { createFileRoute } from '@tanstack/react-router';
import { withForm } from '@/hooks/form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { FieldInfo } from '@/components/Form/FieldInfo';
import { useState, useEffect } from 'react';
import useConfigForm from '@/hooks/use-config-form';
import { formOpts } from '@/components/Form/shared-form';
import { useAppForm } from '@/hooks/form';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc';
import { formatConfigDataForForm } from '@/lib/formatConfigData';
import { useSaveConfigHook } from '@/hooks/saveFormHook';
import { removeEmptyArrayValues } from '@/lib/transformers';
import { generalValidationSchema } from '@/types/config';
import { FormValidationProvider } from '@/contexts/Form/form-validation-provider';
import { pickSchemaFields } from '@/lib/pick-schema-fields';
import { toast } from 'sonner';
import { SettingsLayout } from '@/components/SettingsLayout';
import { Page } from '@/components/Page';

const GeneralSettings = withForm({
  ...formOpts,
  render: function Render() {
    const { isFieldRequired } = useConfigForm(generalValidationSchema);

    const trpc = useTRPC();
    const { data: configData } = useQuery(
      trpc.settings.get.queryOptions(undefined, {
        select: (data) => {
          console.log(data);
          const fullDataset = formatConfigDataForForm(data.config);
          const filteredData = pickSchemaFields(
            generalValidationSchema,
            fullDataset,
            { includeUndefined: true },
          );

          return filteredData;
        },
      }),
    );

    const { saveConfig, isSuccess } = useSaveConfigHook();

    const form = useAppForm({
      ...formOpts,
      defaultValues: configData ?? formOpts.defaultValues,
      onSubmit: async ({ value }) => {
        try {
          const result = generalValidationSchema.safeParse(value);
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
        onSubmit: generalValidationSchema,
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
                  <legend>Misc. Settings</legend>
                  <form.AppField name="includeNonVideos">
                    {(field) => (
                      <field.SwitchField label="Include Non-Videos" />
                    )}
                  </form.AppField>
                  <form.AppField name="includeSingleEpisodes">
                    {(field) => (
                      <field.SwitchField label="Include Single Episodes" />
                    )}
                  </form.AppField>
                  <div className="">
                    <form.AppField name="snatchTimeout" validators={{}}>
                      {(field) => <field.TextField label="Snatch Timeout" />}
                    </form.AppField>
                  </div>
                  <div className="">
                    <form.AppField name="fuzzySizeThreshold" validators={{}}>
                      {(field) => (
                        <field.TextField
                          label="Fuzzy Size Threshold"
                          type="number"
                        />
                      )}
                    </form.AppField>
                  </div>
                  <div className="">
                    <form.AppField name="seasonFromEpisodes" validators={{}}>
                      {(field) => (
                        <field.TextField
                          label="Season from Episodes"
                          type="number"
                        />
                      )}
                    </form.AppField>
                  </div>
                  <div className="">
                    <form.AppField name="autoResumeMaxDownload" validators={{}}>
                      {(field) => (
                        <field.TextField
                          label="Auto-resume Max Download"
                          type="number"
                        />
                      )}
                    </form.AppField>
                  </div>
                  <div className="">
                    <form.Field name="blockList" mode="array" validators={{}}>
                      {(field) => {
                        return (
                          <div className="space-y-3">
                            <Label
                              htmlFor={field.name}
                              className="block w-full"
                            >
                              Block List
                              {isFieldRequired(field.name) && (
                                <span className="pl-1 text-red-500">*</span>
                              )}
                            </Label>
                            {field.state.value &&
                              (field.state.value.length
                                ? field.state.value
                                : ['']
                              ).map((_: string, index: number) => {
                                return (
                                  <div
                                    key={index}
                                    className="gap-y- mb-3 flex flex-col"
                                  >
                                    <form.AppField
                                      name={`blockList[${index}]`}
                                      validators={{
                                        onBlur: z.string(),
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

export const Route = createFileRoute('/settings/general')({
  component: GeneralSettings,
});
