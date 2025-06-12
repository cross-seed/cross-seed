import { withForm } from '@/hooks/form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { FieldInfo } from '@/components/Form/FieldInfo';
import { useState, useEffect } from 'react';
import useConfigForm from '@/hooks/use-config-form';
import { formOpts } from '../../components/Form/shared-form';
import { useAppForm } from '@/hooks/form';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc';
import { formatConfigDataForForm } from '@/lib/formatConfigData';
import { useSaveConfigHook } from '@/hooks/saveFormHook';
import { removeEmptyArrayValues } from '@/lib/transformers';
import { generalValidationSchema } from '@/types/config';
import { FormValidationProvider } from '@/contexts/Form/form-validation-provider';
import { pickSchemaFields } from '@/lib/pick-schema-fields';

const GeneralSettings = withForm({
  ...formOpts,
  render: function Render() {
    const { isFieldRequired } = useConfigForm(generalValidationSchema);
    // const { form } = useConfigFormContext();

    const trpc = useTRPC();
    const {
      data: configData,
      // isLoading,
      // isError,
    } = useQuery(
      trpc.settings.get.queryOptions(undefined, {
        select: (data) => {
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
          const result = generalValidationSchema.safeParse(value);
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
        onSubmit: generalValidationSchema,
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
              <legend>Misc. Settings</legend>
              <form.AppField name="includeNonVideos">
                {(field) => <field.SwitchField label="Include Non-Videos" />}
              </form.AppField>
              <form.AppField name="includeSingleEpisodes">
                {(field) => (
                  <field.SwitchField label="Include Single Episodes" />
                )}
              </form.AppField>
              <div className="">
                <form.AppField
                  name="snatchTimeout"
                  validators={
                    {
                      // onBlur: baseValidationSchema.shape.snatchTimeout,
                    }
                  }
                >
                  {(field) => <field.TextField label="Snatch Timeout" />}
                </form.AppField>
              </div>
              <div className="">
                <form.AppField
                  name="fuzzySizeThreshold"
                  validators={
                    {
                      // onBlur: baseValidationSchema.shape.delay,
                    }
                  }
                >
                  {(field) => (
                    <field.TextField
                      label="Fuzzy Size Threshold"
                      type="number"
                    />
                  )}
                </form.AppField>
              </div>
              <div className="">
                <form.AppField
                  name="seasonFromEpisodes"
                  validators={
                    {
                      // onBlur: baseValidationSchema.shape.delay,
                    }
                  }
                >
                  {(field) => (
                    <field.TextField
                      label="Season from Episodes"
                      type="number"
                    />
                  )}
                </form.AppField>
              </div>
              <div className="">
                <form.AppField
                  name="autoResumeMaxDownload"
                  validators={
                    {
                      // onBlur: baseValidationSchema.shape.delay,
                    }
                  }
                >
                  {(field) => (
                    <field.TextField
                      label="Auto-resume Max Download"
                      type="number"
                    />
                  )}
                </form.AppField>
              </div>
              <div className="">
                <form.Field
                  name="blockList"
                  mode="array"
                  validators={
                    {
                      // onBlur: baseValidationSchema.shape.blockList,
                      // onChange: baseValidationSchema.shape.blockList,
                    }
                  }
                >
                  {(field) => {
                    return (
                      <div className="space-y-3">
                        <Label htmlFor={field.name} className="block w-full">
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
    );
  },
});

export default GeneralSettings;
