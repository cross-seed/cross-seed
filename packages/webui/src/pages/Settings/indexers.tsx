import { withForm } from '@/hooks/form';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { FieldInfo } from '@/components/Form/FieldInfo';
import useConfigForm from '@/hooks/use-config-form';
import { formOpts } from '@/components/Form/shared-form';
import { useAppForm } from '@/hooks/form';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc';
import { formatConfigDataForForm } from '@/lib/formatConfigData';
import { useSaveConfigHook } from '@/hooks/saveFormHook';
import { removeEmptyArrayValues } from '@/lib/transformers';
import { trackerValidationSchema } from '@/types/config';
import { FormValidationProvider } from '@/contexts/Form/form-validation-provider';
import { pickSchemaFields } from '@/lib/pick-schema-fields';
import { toast } from 'sonner';

const IndexerSettings = withForm({
  ...formOpts,
  render: function Render() {
    const { isFieldRequired } = useConfigForm(trackerValidationSchema);

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
            trackerValidationSchema,
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
      // isLoading: isSaving,
      // isError: isSaveError,
    } = useSaveConfigHook();

    const form = useAppForm({
      ...formOpts,
      defaultValues: configData ?? formOpts.defaultValues,
      onSubmit: async ({ value }) => {
        // Full schema validation
        try {
          const result = trackerValidationSchema.safeParse(value);
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
      },
      validators: {
        onSubmit: trackerValidationSchema,
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

    useEffect(() => {
      if (isSuccess) {
          toast.success('Configuration saved successfully!', {
            description: 'Your changes will take effect on the next restart.',
          });
      }
    }, [isSuccess]);

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
              <legend>Torznab</legend>
              <div className="">
                <form.Field
                  name="torznab"
                  mode="array"
                  // validators={{
                  //   onBlur: baseValidationSchema.shape.torznab,
                  //   onChange: ({ value }) => {
                  //     const results = baseValidationSchema.shape.torznab.safeParse(value);
                  //     if (!results.success) {
                  //       return results.error.format()._errors;
                  //     }
                  //     return undefined;
                  //   }
                  // }}
                >
                  {(field) => {
                    return (
                      <div className="space-y-3">
                        <Label htmlFor={field.name} className="block w-full">
                          Torznab URL(s)
                          {isFieldRequired(field.name) && (
                            <span className="pl-1 text-red-500">*</span>
                          )}
                        </Label>
                        {field.state.value.map((_: string, index: number) => {
                          return (
                            <div
                              key={index}
                              className="gap-y- mb-3 flex flex-col"
                            >
                              <form.AppField
                                name={`torznab[${index}]`}
                                validators={{
                                  onBlur: z.string().url(),
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

export default IndexerSettings;
