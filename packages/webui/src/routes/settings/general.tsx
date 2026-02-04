import { createFileRoute } from '@tanstack/react-router';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { FieldInfo } from '@/components/Form/FieldInfo';
import { useState, useEffect } from 'react';
import useConfigForm from '@/hooks/use-config-form';
import { defaultGeneralFormValues } from '@/components/Form/shared-form';
import { useAppForm } from '@/hooks/form';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc';
import { Input } from '@/components/ui/input';
import DeleteOption from '@/components/Buttons/DeleteOption';
import { formatConfigDataForForm } from '@/lib/formatConfigData';
import { generalValidationSchema } from '@/types/config';
import { FormValidationProvider } from '@/contexts/Form/form-validation-provider';
import { pickSchemaFields } from '@/lib/pick-schema-fields';
import { Page } from '@/components/Page';
import { useSettingsFormSubmit } from '@/hooks/use-settings-form-submit';
import { z } from 'zod';
import { RuntimeConfig } from '../../../../shared/configSchema';

type GeneralFormData = z.infer<typeof generalValidationSchema>;

function GeneralSettings() {
  const { isFieldRequired } = useConfigForm(generalValidationSchema);

  const trpc = useTRPC();
  const { data: configData } = useQuery(
    trpc.settings.get.queryOptions(undefined, {
      select: (data: {
        config: RuntimeConfig;
        apikey: string;
      }): Partial<GeneralFormData> => {
        const fullDataset = formatConfigDataForForm(data.config);
        const filteredData = pickSchemaFields(
          generalValidationSchema,
          fullDataset,
          { includeUndefined: true },
        ) as Partial<GeneralFormData>;

        return filteredData;
      },
    }),
  );

  const handleSubmit = useSettingsFormSubmit();

  const form = useAppForm({
    defaultValues: (configData ?? defaultGeneralFormValues) as GeneralFormData,
    onSubmit: handleSubmit,
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

  return (
    <Page>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">General Settings</h1>
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
                <form.AppField name="includeNonVideos">
                  {(field) => <field.SwitchField label="Include Non-Videos" />}
                </form.AppField>
                <form.AppField name="includeSingleEpisodes">
                  {(field) => (
                    <field.SwitchField label="Include Single Episodes" />
                  )}
                </form.AppField>
                <div className="">
                  <form.AppField name="snatchTimeout" validators={{}}>
                    {(field) => <field.DurationField label="Snatch Timeout" />}
                  </form.AppField>
                </div>
                <div className="">
                  <form.AppField name="fuzzySizeThreshold" validators={{}}>
                    {(field) => (
                      <field.NumberField
                        label="Fuzzy Size Threshold"
                        step="0.01"
                      />
                    )}
                  </form.AppField>
                </div>
                <div className="">
                  <form.AppField name="seasonFromEpisodes" validators={{}}>
                    {(field) => (
                      <field.NumberField label="Season from Episodes" min="0" />
                    )}
                  </form.AppField>
                </div>
                <div className="">
                  <form.AppField name="autoResumeMaxDownload">
                    {(field) => (
                      <field.NumberField label="Auto-resume Max Download" />
                    )}
                  </form.AppField>
                </div>
                <div className="">
                  <form.Field name="blockList" mode="array">
                    {(field) => (
                      <div className="space-y-3">
                        <Label htmlFor={field.name} className="block w-full">
                          Block List
                          {isFieldRequired(field.name) && (
                            <span className="pl-1 text-red-500">*</span>
                          )}
                        </Label>
                        {field.state.value.map(
                          (_value: string, index: number) => (
                            <form.Field
                              key={`${field.name}-${index}`}
                              name={`blockList[${index}]`}
                            >
                              {(subfield) => (
                                <div className="gap-y- mb-3 flex flex-col">
                                  <div className="flex items-center gap-2">
                                    <Input
                                      type="text"
                                      className="form-input"
                                      value={subfield.state.value}
                                      aria-invalid={
                                        !!(
                                          subfield.state.meta.isTouched &&
                                          subfield.state.meta.errorMap.onBlur
                                        )
                                      }
                                      onBlur={subfield.handleBlur}
                                      onChange={(e) =>
                                        subfield.handleChange(e.target.value)
                                      }
                                    />
                                    {field.state.value.length > 1 && (
                                      <DeleteOption
                                        onClick={() => {
                                          field.removeValue(index);
                                        }}
                                      />
                                    )}
                                  </div>

                                  {subfield.state.meta.isTouched &&
                                    subfield.state.meta.errors && (
                                      <FieldInfo
                                        fieldMeta={subfield.state.meta}
                                      />
                                    )}
                                </div>
                              )}
                            </form.Field>
                          ),
                        )}
                        <Button
                          variant="secondary"
                          type="button"
                          onClick={() => {
                            field.pushValue('');
                            setLastFieldAdded(
                              `${field.name}-${field.state.value.length}`,
                            );
                          }}
                          title={`Add ${field.name}`}
                        >
                          Add
                        </Button>
                      </div>
                    )}
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

export const Route = createFileRoute('/settings/general')({
  component: GeneralSettings,
});
