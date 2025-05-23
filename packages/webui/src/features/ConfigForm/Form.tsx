import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { baseValidationSchema, Config } from '@/types/config';
import { useQuery } from '@tanstack/react-query';
import { FC, useEffect, useState } from 'react';
import { z } from 'zod';
import './Form.css';
import { defaultConfig, LinkType } from '../../../../shared/constants';
import { FieldInfo } from '@/components/Form/FieldInfo';
import { useAppForm } from '@/hooks/form';
import { formatConfigDataForForm } from './lib/formatConfigData';
import { removeEmptyArrayValues } from './lib/transformers';
import { LoaderCircle } from 'lucide-react';
import ConnectCrossSeedFields from './connect-crossseed-fields';
import DownloadingFields from './downloading-fields';
import SearchingRssFields from './searching-rss-fields';
// import useConfigForm from '@/hooks/use-config-form';

type FormProps = {
  className?: string;
};

export const ConfigForm: FC<FormProps> = ({ className }) => {
  const trpc = useTRPC();
  const {
    data: configData,
    isLoading,
    isError,
  } = useQuery(
    trpc.config.get.queryOptions(undefined, {
      select: (data) => formatConfigDataForForm(data.config),
    }),
  );

  // const { config: configData, validationSchema: baseValidationSchema } =
  //   useConfigForm();

  const form = useAppForm({
    defaultValues: configData ?? defaultConfig,
    onSubmit: async ({ value }) => {
      console.log('submitting form', value);
      // Full schema validation
      // Fake a long response delay
      setTimeout(() => {
        try {
          console.log('Full validation attempt...');
          const result = baseValidationSchema.safeParse(value);
          if (!result.success) {
            console.error('FULL VALIDATION FAILED:', result.error.format());
          } else {
            console.log('Full validation success!', value, Object.keys(value));
            // remove empty values from array fields
            Object.keys(value).forEach((attr) => {
              if (Array.isArray(value[attr])) {
                value[attr] = removeEmptyArrayValues(value[attr]);
              }
            });

            console.log('cleaned values', value);
          }
        } catch (err) {
          console.error('Exception during full validation:', err);
          return {
            status: 'error',
            error: { _form: 'An unexpected error occurred during validation' },
          };
        }
      }, 2000);
    },
    validators: {
      onSubmit: baseValidationSchema,
    },
  });

  const isFieldRequired = (fieldName: string) => {
    const schemaField = baseValidationSchema.shape[fieldName as keyof Config];
    return !schemaField.isOptional() && !schemaField.isNullable();
  };

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

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (isError) {
    console.error('Error fetching config file:', isError);
    // return <div>Error: {JSON.stringify(isError)}</div>;
  }

  return (
    <div className={cn('mb-5', className)}>
      <h2 className="mb-6 text-2xl font-semibold">Edit Config</h2>
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
          <fieldset className="form-fieldset w-full gap-6 rounded-md">
            <legend>Directories and Paths</legend>
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
                        field.state.value.map((_: string, index: number) => {
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
                        })}
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
            <form.Field
              name="flatLinking"
              validators={{
                onChange: baseValidationSchema.shape.flatLinking,
              }}
            >
              {(field) => {
                return (
                  <div className="form-field__switch flex flex-col items-start gap-5">
                    <Label htmlFor={field.name} className="mr-3">
                      Flat linking
                    </Label>
                    <Switch
                      id={field.name}
                      checked={field.state.value ?? false}
                      onCheckedChange={field.handleChange}
                    />
                  </div>
                );
              }}
            </form.Field>
            <div className="">
              <form.Field
                name="linkType"
                validators={{
                  onChange: baseValidationSchema.shape.linkType,
                }}
              >
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Link Type
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Select
                      name={field.name}
                      defaultValue={field.state.value}
                      onValueChange={(e) => field.handleChange(e as LinkType)}
                    >
                      <SelectTrigger className="w-full shadow-none">
                        <SelectValue placeholder="Select a link type" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.keys(LinkType).map((key) => (
                          <SelectItem
                            key={key.toLowerCase()}
                            value={key.toLowerCase()}
                          >
                            {key.toLowerCase()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldInfo fieldMeta={field.state.meta} />
                    {field.state.value}
                  </div>
                )}
              </form.Field>
            </div>
            <div className="">
              <form.Field
                name="linkDirs"
                mode="array"
                validators={{
                  onBlur: baseValidationSchema.shape.linkDirs,
                  onChange: baseValidationSchema.shape.linkDirs,
                }}
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
                      {field.state.value?.map((_: string, index: number) => {
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
                      })}
                      <Button
                        variant="secondary"
                        type="button"
                        onClick={() => {
                          field.pushValue('');
                          setLastFieldAdded(
                            `${field.name}-${field.state.value ? field.state.value.length - 1 : 0}`,
                          );
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
          <fieldset className="form-fieldset w-full gap-6 rounded-md">
            <legend>Connecting to Other Apps</legend>
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
                          setLastFieldAdded(
                            `${field.name}-${field.state.value.length - 1}`,
                          );
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
                          setLastFieldAdded(
                            `${field.name}-${field.state.value ? field.state.value.length - 1 : 0}`,
                          );
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
          </fieldset>

          {/* Connect to Cross Seed  */}
          <ConnectCrossSeedFields form={form} />

          {/* Downloading */}
          <DownloadingFields form={form} />

          {/* Searching & RSS */}
          <SearchingRssFields form={form} />

          <fieldset className="form-fieldset w-full gap-6 rounded-md">
            <legend>Misc. Settings</legend>
            <form.Field name="includeNonVideos">
              {(field) => {
                return (
                  <div className="form-field__switch flex items-center">
                    <Label htmlFor={field.name} className="mr-3">
                      Include Non-Videos
                    </Label>
                    <Switch
                      id={field.name}
                      checked={field.state.value}
                      onCheckedChange={field.handleChange}
                    />
                  </div>
                );
              }}
            </form.Field>
            <form.Field name="includeSingleEpisodes">
              {(field) => {
                return (
                  <div className="form-field__switch flex items-center">
                    <Label htmlFor={field.name} className="mr-3">
                      Include Single Episodes
                    </Label>
                    <Switch
                      id={field.name}
                      checked={field.state.value}
                      onCheckedChange={field.handleChange}
                    />
                  </div>
                );
              }}
            </form.Field>
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
                          setLastFieldAdded(
                            `${field.name}-${field.state.value?.length ? field.state.value.length - 1 : 0}`,
                          );
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
        </div>

        {/* The submit button */}
        <form.Subscribe
          selector={(state) => [
            state.canSubmit,
            state.isSubmitting,
            state.errors,
            state.fieldMeta,
          ]}
        >
          {([canSubmit, isSubmitting, errors, fieldMeta]) => (
            <div className="form__submit border-border bg-background sticky right-0 bottom-0 left-0 -mr-4 -ml-11 border-t border-solid p-6">
              <Button
                type="submit"
                className={cn(
                  'w-full rounded-md px-4 py-6 transition-colors duration-150',
                  { isSubmitting: 'opacity-70' },
                )}
                disabled={!canSubmit}
              >
                {isSubmitting ? (
                  <>
                    <LoaderCircle className="animate-spin" /> Saving...
                  </>
                ) : (
                  'Save'
                )}{' '}
                "{canSubmit && 'can submit'}"
              </Button>
              {Object.keys(errors).length > 0 && (
                <div className="mt-4 rounded-md bg-red-50 p-4 text-sm text-red-700">
                  <h4 className="font-medium">
                    Please fix the following errors:
                  </h4>
                  <ul className="mt-2 list-disc pl-5">
                    {JSON.stringify(fieldMeta)}
                    {Object.entries(errors).map(([field, error]) => (
                      <li key={field}>
                        {field}:{' '}
                        {typeof error === 'string'
                          ? error
                          : JSON.stringify(error)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </form.Subscribe>
        <form.Subscribe>
          {(state) => (
            <div
              className="bg-card text-card-foreground w-lg overflow-auto p-4 shadow-lg"
              // className="fixed right-0 bottom-0 z-50 max-h-96 w-lg overflow-auto bg-white p-4 shadow-lg dark:bg-slate-800 dark:text-white"
              style={{ opacity: 0.9 }}
            >
              <h3 className="mb-2 text-lg font-bold">Form Debug</h3>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  console.log('Full form state:', state);

                  // Test validate all fields
                  Object.keys(state.fields).forEach((fieldName) => {
                    try {
                      if (baseValidationSchema.shape[fieldName]) {
                        const validationResult = baseValidationSchema.shape[
                          fieldName
                        ].safeParse(state.values[fieldName]);
                        if (!validationResult.success) {
                          console.error(
                            `Field ${fieldName} validation failed:`,
                            validationResult.error,
                          );
                        }
                      }
                    } catch (e) {
                      console.error(`Error validating ${fieldName}:`, e);
                    }
                  });
                }}
                className="mb-2 rounded bg-blue-500 px-2 py-1 text-white"
              >
                Log State
              </button>
              <div className="text-xs">
                <pre className="overflow-auto">
                  {JSON.stringify(
                    {
                      errors: Object.fromEntries(
                        Object.entries(state.fieldMeta)
                          .filter(([_, meta]) => meta.errors?.length > 0)
                          .map(([name, meta]) => [name, meta.errors]),
                      ),
                      hasErrors: !state.canSubmit,
                    },
                    null,
                    2,
                  )}
                </pre>
              </div>
            </div>
          )}
        </form.Subscribe>
      </form>
    </div>
  );
};
