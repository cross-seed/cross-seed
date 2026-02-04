import { LinkType } from '../../../../shared/constants';
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
import { directoryValidationSchema } from '@/types/config';
import { FormValidationProvider } from '@/contexts/Form/form-validation-provider';
import { pickSchemaFields } from '@/lib/pick-schema-fields';
import { createFileRoute } from '@tanstack/react-router';
import { Page } from '@/components/Page';
import { useSettingsFormSubmit } from '@/hooks/use-settings-form-submit';

function DirectorySettings() {
  const { isFieldRequired } = useConfigForm(directoryValidationSchema);

  const trpc = useTRPC();
  const { data: configData } = useQuery(
    trpc.settings.get.queryOptions(undefined, {
      select: (data) => {
        const fullDataset = formatConfigDataForForm(data.config);
        const filteredData = pickSchemaFields(
          directoryValidationSchema,
          fullDataset,
          { includeUndefined: true },
        );

        return filteredData;
      },
    }),
  );

  const handleSubmit = useSettingsFormSubmit();

  const form = useAppForm({
    ...formOpts,
    defaultValues: configData ?? formOpts.defaultValues,
    onSubmit: handleSubmit,
    validators: {
      onSubmit: directoryValidationSchema,
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
    <Page>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Directory & Path Settings</h1>
          <p className="text-muted-foreground">
            Manage the directories and paths used by cross-seed.
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
            {/* form fields */}
            <div className="flex flex-wrap gap-6">
              <fieldset className="form-fieldset w-full gap-6">
                <div className="">
                  <form.Field
                    name="dataDirs"
                    mode="array"
                    validators={
                      {
                        // onBlur: baseValidationSchema.shape.dataDirs,
                        // onChange: baseValidationSchema.shape.dataDirs,
                      }
                    }
                  >
                    {(field) => {
                      return (
                        <div className="space-y-3">
                          <Label htmlFor={field.name} className="block w-full">
                            Data Directories
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
                                      name={`dataDirs[${index}]`}
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
                              },
                            )}
                          <Button
                            variant="secondary"
                            type="button"
                            onClick={() => {
                              field.pushValue('');
                              if (field.state.value?.length) {
                                setLastFieldAdded(
                                  `${field.name}-${field.state.value.length - 1}`,
                                );
                              }
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
                <form.AppField
                  name="flatLinking"
                  validators={
                    {
                      // onChange: baseValidationSchema.shape.flatLinking,
                    }
                  }
                >
                  {(field) => (
                    <field.SwitchField
                      label="Flat Linking"
                      className="form-field__switch flex flex-col items-start gap-5"
                    />
                  )}
                </form.AppField>
                <div className="">
                  <form.AppField name="linkType">
                    {(field) => (
                      <field.SelectField label="Link Type" options={LinkType} />
                    )}
                  </form.AppField>
                </div>
                <div className="">
                  <form.Field
                    name="linkDirs"
                    mode="array"
                    validators={
                      {
                        // onBlur: baseValidationSchema.shape.linkDirs,
                        // onChange: baseValidationSchema.shape.linkDirs,
                      }
                    }
                  >
                    {(field) => {
                      return (
                        <div className="space-y-3">
                          <Label htmlFor={field.name} className="block w-full">
                            Link Directories
                            {isFieldRequired(field.name) && (
                              <span className="pl-1 text-red-500">*</span>
                            )}
                          </Label>
                          {field.state.value?.map(
                            (_: string, index: number) => {
                              return (
                                <div
                                  key={index}
                                  className="gap-y- mb-3 flex flex-col"
                                >
                                  <form.AppField
                                    name={`linkDirs[${index}]`}
                                    validators={{
                                      onBlur: z.string(),
                                    }}
                                  >
                                    {(subfield) => (
                                      <subfield.ArrayField
                                        showDelete={
                                          (field.state.value &&
                                            field.state.value?.length > 1) ??
                                          undefined
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
                <div className="">
                  <form.AppField
                    name="maxDataDepth"
                    validators={
                      {
                        // onBlur: baseValidationSchema.shape.delay,
                      }
                    }
                  >
                    {(field) => <field.NumberField label="Max Data Depth" />}
                  </form.AppField>
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

export const Route = createFileRoute('/settings/directories')({
  component: DirectorySettings,
});
