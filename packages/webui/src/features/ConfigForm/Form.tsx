import { FC, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import './Form.css';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { FieldInfo } from './FieldInfo';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Action, LinkType, MatchMode } from '../../../../shared/constants';
import { baseValidationSchema, Config } from '@/types/config';
import { Button } from '@/components/ui/button';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTrash } from '@fortawesome/free-solid-svg-icons';
import { trpc } from '@/lib/trpc';
import { defaultConfig } from '../../../../shared/constants';
import { formatConfigDataForForm } from './lib/formatConfigData';
import { removeEmptyArrayValues } from './lib/transformers';

type FormProps = {
  className?: string;
};

export const ConfigForm: FC<FormProps> = ({ className }) => {
  const {
    data: configData,
    isLoading,
    isError,
  } = trpc.config.get.useQuery(undefined, {
    select: (data) => ({
      ...formatConfigDataForForm(data.config),
    }),
  });

  // useEffect(() => {
  //   console.log('configData', configData);
  // }, [configData]);

  const form = useForm({
    defaultValues: configData ?? defaultConfig,
    onSubmit: async ({ value }) => {
      console.log('submitting form', value);
      // Full schema validation
      try {
        console.log('Full validation attempt...');
        const result = baseValidationSchema.safeParse(value);
        if (!result.success) {
          console.error('FULL VALIDATION FAILED:', result.error.format());
        } else {
          console.log('Full validation success!', value, Object.keys(value));
          // TODO: check all of the array fields and remove empty values
          Object.keys(value).forEach((key, value) => {
            console.log('before', key, value[key]);
            if (Array.isArray(value[key])) {
              return removeEmptyArrayValues(value[key]);
            }
          });
          return { status: 'success' };
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
      <h2 className="mb-6 text-2xl font-semibold dark:text-slate-100">
        Edit Config
      </h2>
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
        <div className="flex flex-wrap gap-6 dark:text-slate-100">
          <fieldset className="form-fieldset w-full gap-6 rounded-md">
            <legend>Directories and Paths</legend>
            <div className="">
              <form.Field
                name="dataDirs"
                mode="array"
                validators={{
                  onBlur: baseValidationSchema.shape.dataDirs,
                  onChange: baseValidationSchema.shape.dataDirs,
                }}
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
                              <form.Field
                                name={`dataDirs[${index}]`}
                                validators={{
                                  onBlur: z.string(),
                                }}
                              >
                                {(subfield) => {
                                  return (
                                    <>
                                      <div className="flex items-center gap-2">
                                        <Input
                                          type="text"
                                          id={`${field.name}-${index}`}
                                          className="form-input"
                                          value={subfield.state.value ?? ''}
                                          aria-invalid={
                                            !!(
                                              subfield.state.meta.isTouched &&
                                              (
                                                subfield.state.meta.errorMap
                                                  .onBlur as string
                                              )?.length > 0
                                            )
                                          }
                                          onBlur={subfield.handleBlur}
                                          onChange={(e) =>
                                            subfield.handleChange(
                                              e.target.value,
                                            )
                                          }
                                        />
                                        {field.state.value &&
                                          field.state.value?.length > 1 && (
                                            <Button
                                              onClick={() =>
                                                field.removeValue(index)
                                              }
                                              className="rounded border border-red-500/30 bg-transparent text-red-500/30 shadow-none transition-all duration-150 outline-none hover:bg-red-500 hover:text-white focus:bg-red-500 focus:text-white focus-visible:border-red-500 focus-visible:ring-red-300/40"
                                            >
                                              <FontAwesomeIcon icon={faTrash} />
                                            </Button>
                                          )}
                                      </div>
                                      {/* <FieldInfo fieldMeta={subfield} /> */}
                                    </>
                                  );
                                }}
                              </form.Field>
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
                        className="focus-visible:ring-accent-300/40 h-auto rounded border border-slate-500 bg-slate-200 px-2.5 py-1.5 text-slate-800 shadow-none transition-colors duration-150 hover:bg-slate-100 disabled:opacity-35"
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
                      className="data-[state='checked']:!bg-accent focus-visible:border-accent-700 focus-visible:ring-accent-300 shadow-none"
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
                      <SelectTrigger className="focus-visible:ring-accent-300/40 border-slate-300 bg-white shadow-none">
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
                            <form.Field
                              name={`linkDirs[${index}]`}
                              validators={{
                                onBlur: z.string(),
                              }}
                            >
                              {(subfield) => {
                                return (
                                  <>
                                    <div className="flex items-center gap-2">
                                      <Input
                                        type="text"
                                        className="form-input"
                                        id={`${field.name}-${index}`}
                                        value={subfield.state.value ?? ''}
                                        aria-invalid={
                                          !!(
                                            subfield.state.meta.isTouched &&
                                            (
                                              subfield.state.meta.errorMap
                                                .onBlur as string
                                            )?.length > 0
                                          )
                                        }
                                        onBlur={subfield.handleBlur}
                                        onChange={(e) =>
                                          subfield.handleChange(e.target.value)
                                        }
                                      />
                                      {field.state.value &&
                                        field.state.value.length > 1 && (
                                          <Button
                                            onClick={() =>
                                              field.removeValue(index)
                                            }
                                            className="rounded border border-red-500/30 bg-transparent text-red-500/30 shadow-none transition-all duration-150 outline-none hover:bg-red-500 hover:text-white focus:bg-red-500 focus:text-white focus-visible:border-red-500 focus-visible:ring-red-300/40"
                                          >
                                            <FontAwesomeIcon icon={faTrash} />
                                          </Button>
                                        )}
                                    </div>
                                    {/* <FieldInfo fieldMeta={subfield} /> */}
                                  </>
                                );
                              }}
                            </form.Field>
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
                        className="focus-visible:ring-accent-300/40 h-auto rounded border border-slate-500 bg-slate-200 px-2.5 py-1.5 text-slate-800 shadow-none transition-colors duration-150 hover:bg-slate-100 disabled:opacity-35"
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
                            <form.Field
                              name={`torznab[${index}]`}
                              validators={{
                                onBlur: z.string().url(),
                              }}
                            >
                              {(subfield) => {
                                return (
                                  <>
                                    <div className="flex items-center gap-2">
                                      <Input
                                        type="text"
                                        className="form-input"
                                        id={`${field.name}-${index}`}
                                        value={subfield.state.value ?? ''}
                                        aria-invalid={
                                          !!(
                                            subfield.state.meta.isTouched &&
                                            (
                                              subfield.state.meta.errorMap
                                                .onBlur as string
                                            )?.length > 0
                                          )
                                        }
                                        onBlur={subfield.handleBlur}
                                        onChange={(e) =>
                                          subfield.handleChange(e.target.value)
                                        }
                                      />
                                      {field.state.value.length > 1 && (
                                        <Button
                                          onClick={() =>
                                            field.removeValue(index)
                                          }
                                          className="rounded border border-red-500/30 bg-transparent text-red-500/30 shadow-none transition-all duration-150 outline-none hover:bg-red-500 hover:text-white focus:bg-red-500 focus:text-white focus-visible:border-red-500 focus-visible:ring-red-300/40"
                                        >
                                          <FontAwesomeIcon icon={faTrash} />
                                        </Button>
                                      )}
                                    </div>
                                    {/* <FieldInfo field={subfield} /> */}
                                  </>
                                );
                              }}
                            </form.Field>
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
                        className="focus-visible:ring-accent-300/40 h-auto rounded border border-slate-500 bg-slate-200 px-2.5 py-1.5 text-slate-800 shadow-none transition-colors duration-150 hover:bg-slate-100 disabled:opacity-35"
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
                  onBlur: baseValidationSchema.shape.notificationWebhookUrls,
                  onChange: baseValidationSchema.shape.notificationWebhookUrls,
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
                            <form.Field
                              name={`notificationWebhookUrls[${index}]`}
                              validators={{
                                onBlur: z
                                  .string()
                                  .min(3)
                                  .url()
                                  .or(z.literal('')),
                              }}
                            >
                              {(subfield) => {
                                return (
                                  <>
                                    <div className="flex items-center gap-2">
                                      <Input
                                        type="text"
                                        className="form-input"
                                        id={`${field.name}-${index}`}
                                        value={subfield.state.value ?? ''}
                                        aria-invalid={
                                          !!(
                                            subfield.state.meta.isTouched &&
                                            (
                                              subfield.state.meta.errorMap
                                                .onBlur as string
                                            )?.length > 0
                                          )
                                        }
                                        onBlur={subfield.handleBlur}
                                        onChange={(e) =>
                                          subfield.handleChange(e.target.value)
                                        }
                                      />
                                      {field.state.value &&
                                        field.state.value.length > 1 && (
                                          <Button
                                            onClick={() =>
                                              field.removeValue(index)
                                            }
                                            className="rounded border border-red-500/30 bg-transparent text-red-500/30 shadow-none transition-all duration-150 outline-none hover:bg-red-500 hover:text-white focus:bg-red-500 focus:text-white focus-visible:border-red-500 focus-visible:ring-red-300/40"
                                          >
                                            <FontAwesomeIcon icon={faTrash} />
                                          </Button>
                                        )}
                                    </div>
                                    {/* <FieldInfo field={subfield} /> */}
                                  </>
                                );
                              }}
                            </form.Field>
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
                        className="focus-visible:ring-accent-300/40 h-auto rounded border border-slate-500 bg-slate-200 px-2.5 py-1.5 text-slate-800 shadow-none transition-colors duration-150 hover:bg-slate-100 disabled:opacity-35"
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
                validators={{
                  onBlur: baseValidationSchema.shape.sonarr,
                  onChange: baseValidationSchema.shape.sonarr,
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
                              <form.Field
                                name={`sonarr[${index}]`}
                                validators={{
                                  onBlur: z.string().url().or(z.literal('')),
                                }}
                              >
                                {(subfield) => {
                                  return (
                                    <>
                                      <div className="flex items-center gap-2">
                                        <Input
                                          type="text"
                                          className="form-input"
                                          id={`${field.name}-${index}`}
                                          value={subfield.state.value ?? ''}
                                          aria-invalid={
                                            !!(
                                              subfield.state.meta.isTouched &&
                                              (
                                                subfield.state.meta.errorMap
                                                  .onBlur as string
                                              )?.length > 0
                                            )
                                          }
                                          onBlur={subfield.handleBlur}
                                          onChange={(e) =>
                                            subfield.handleChange(
                                              e.target.value,
                                            )
                                          }
                                        />
                                        {field.state.value &&
                                          field.state.value.length > 1 && (
                                            <Button
                                              onClick={() =>
                                                field.removeValue(index)
                                              }
                                              className="rounded border border-red-500/30 bg-transparent text-red-500/30 shadow-none transition-all duration-150 outline-none hover:bg-red-500 hover:text-white focus:bg-red-500 focus:text-white focus-visible:border-red-500 focus-visible:ring-red-300/40"
                                            >
                                              <FontAwesomeIcon icon={faTrash} />
                                            </Button>
                                          )}
                                      </div>
                                      {/* <FieldInfo field={subfield} /> */}
                                    </>
                                  );
                                }}
                              </form.Field>
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
                        className="focus-visible:ring-accent-300/40 h-auto rounded border border-slate-500 bg-slate-200 px-2.5 py-1.5 text-slate-800 shadow-none transition-colors duration-150 hover:bg-slate-100 disabled:opacity-35"
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
                  onBlur: baseValidationSchema.shape.radarr,
                  onChange: baseValidationSchema.shape.radarr,
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
                              <form.Field
                                name={`radarr[${index}]`}
                                validators={{
                                  onBlur: z.string().url().or(z.literal('')),
                                }}
                              >
                                {(subfield) => {
                                  return (
                                    <>
                                      <div className="flex items-center gap-2">
                                        <Input
                                          type="text"
                                          className="form-input"
                                          id={`${field.name}-${index}`}
                                          value={subfield.state.value ?? ''}
                                          aria-invalid={
                                            !!(
                                              subfield.state.meta.isTouched &&
                                              (
                                                subfield.state.meta.errorMap
                                                  .onBlur as string
                                              )?.length > 0
                                            )
                                          }
                                          onBlur={subfield.handleBlur}
                                          onChange={(e) =>
                                            subfield.handleChange(
                                              e.target.value,
                                            )
                                          }
                                        />
                                        {field.state.value &&
                                          field.state.value.length > 1 && (
                                            <Button
                                              onClick={() =>
                                                field.removeValue(index)
                                              }
                                              className="rounded border border-red-500/30 bg-transparent text-red-500/30 shadow-none transition-all duration-150 outline-none hover:bg-red-500 hover:text-white focus:bg-red-500 focus:text-white focus-visible:border-red-500 focus-visible:ring-red-300/40"
                                            >
                                              <FontAwesomeIcon icon={faTrash} />
                                            </Button>
                                          )}
                                      </div>
                                      {/* <FieldInfo field={subfield} /> */}
                                    </>
                                  );
                                }}
                              </form.Field>
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
                        className="focus-visible:ring-accent-300/40 h-auto rounded border border-slate-500 bg-slate-200 px-2.5 py-1.5 text-slate-800 shadow-none transition-colors duration-150 hover:bg-slate-100 disabled:opacity-35"
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
            <legend>Connect to Cross Seed</legend>
            <div>
              <form.Field
                name="host"
                validators={{
                  onBlur: baseValidationSchema.shape.host,
                }}
              >
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Host
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="text"
                      className="form-input"
                      name={field.name}
                      id={field.name}
                      value={field.state.value ?? ''}
                      aria-invalid={
                        field.state.meta.isTouched &&
                        field.state.meta.errors?.length > 0
                      }
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldInfo fieldMeta={field.state.meta} />
                  </div>
                )}
              </form.Field>
            </div>
            <div className="">
              <form.Field
                name="port"
                validators={{
                  onBlur: baseValidationSchema.shape.port,
                }}
              >
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Port
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="number"
                      className="form-input"
                      name={field.name}
                      id={field.name}
                      value={field.state.value ?? ''}
                      aria-invalid={
                        field.state.meta.isTouched &&
                        field.state.meta.errors?.length > 0
                      }
                      onBlur={field.handleBlur}
                      onChange={(e) =>
                        field.handleChange(Number(e.target.value))
                      }
                    />
                    <FieldInfo fieldMeta={field.state.meta} />
                  </div>
                )}
              </form.Field>
            </div>
            <div className="">
              <form.Field
                name="apiKey"
                validators={{
                  onBlur: baseValidationSchema.shape.apiKey,
                }}
              >
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      API Key (<code>apiKey</code>)
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="text"
                      className="form-input"
                      name={field.name}
                      id={field.name}
                      value={field.state.value ?? ''}
                      aria-invalid={
                        field.state.meta.isTouched &&
                        field.state.meta.errors?.length > 0
                      }
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldInfo fieldMeta={field.state.meta} />
                  </div>
                )}
              </form.Field>
            </div>
          </fieldset>
          <fieldset className="form-fieldset w-full gap-6 rounded-md">
            <legend>Downloading</legend>
            <p className="col-span-2 text-sm text-slate-400">
              Choose one client application to use for downloading and add its
              details here.
            </p>
            <div>
              <form.Field
                name="rtorrentRpcUrl"
                validators={{
                  onBlur: baseValidationSchema.shape.rtorrentRpcUrl,
                }}
              >
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      rTorrent RPC URL
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="url"
                      className="form-input"
                      name={field.name}
                      id={field.name}
                      placeholder="http://username:password@localhost:1234/RPC2"
                      value={field.state.value ?? ''}
                      aria-invalid={
                        field.state.meta.isTouched &&
                        field.state.meta.errors?.length > 0
                      }
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldInfo fieldMeta={field.state.meta} />
                  </div>
                )}
              </form.Field>
            </div>
            <div>
              <form.Field
                name="qbittorrentUrl"
                validators={{
                  onBlur: baseValidationSchema.shape.qbittorrentUrl,
                }}
              >
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      qBittorrent URL
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="url"
                      className="form-input"
                      name={field.name}
                      id={field.name}
                      placeholder="http://username:password@localhost:8080"
                      value={field.state.value ?? ''}
                      aria-invalid={
                        field.state.meta.isTouched &&
                        field.state.meta.errors?.length > 0
                      }
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldInfo fieldMeta={field.state.meta} />
                  </div>
                )}
              </form.Field>
            </div>
            <div>
              <form.Field
                name="transmissionRpcUrl"
                validators={{
                  onBlur: baseValidationSchema.shape.transmissionRpcUrl,
                }}
              >
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Transmission RPC URL
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="url"
                      className="form-input"
                      name={field.name}
                      id={field.name}
                      placeholder="http://username:password@localhost:9091/transmission/rpc"
                      value={field.state.value ?? ''}
                      aria-invalid={
                        field.state.meta.isTouched &&
                        field.state.meta.errors?.length > 0
                      }
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldInfo fieldMeta={field.state.meta} />
                  </div>
                )}
              </form.Field>
            </div>
            <div>
              <form.Field
                name="delugeRpcUrl"
                validators={{
                  onBlur: baseValidationSchema.shape.delugeRpcUrl,
                }}
              >
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Deluge RPC URL
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="url"
                      className="form-input"
                      name={field.name}
                      id={field.name}
                      placeholder="http://:password@localhost:8112/json"
                      value={field.state.value ?? ''}
                      aria-invalid={
                        field.state.meta.isTouched &&
                        field.state.meta.errors?.length > 0
                      }
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldInfo fieldMeta={field.state.meta} />
                  </div>
                )}
              </form.Field>
            </div>
            <Separator className="col-span-2 my-5" />
            <div className="">
              <form.Field name="action">
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Action
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Select
                      name={field.name}
                      defaultValue={field.state.value}
                      onValueChange={(e) => field.handleChange(e as Action)}
                    >
                      <SelectTrigger className="focus-visible:ring-accent-300/40 border-slate-300 bg-white shadow-none">
                        <SelectValue placeholder="Select an action" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.keys(Action).map((key) => (
                          <SelectItem
                            key={key.toLowerCase()}
                            value={key.toLowerCase()}
                          >
                            {key.toLowerCase()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </form.Field>
            </div>
            <div className="">
              <form.Field
                name="linkCategory"
                validators={{
                  onBlur: baseValidationSchema.shape.linkCategory,
                }}
              >
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Link Category
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="text"
                      className="form-input"
                      name={field.name}
                      id={field.name}
                      value={field.state.value ?? ''}
                      aria-invalid={
                        field.state.meta.isTouched &&
                        field.state.meta.errors?.length > 0
                      }
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldInfo fieldMeta={field.state.meta} />
                  </div>
                )}
              </form.Field>
            </div>
            <div className="">
              <form.Field
                name="torrentDir"
                validators={{
                  onBlur: baseValidationSchema.shape.torrentDir,
                }}
              >
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Torrent Directory
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="text"
                      className="form-input"
                      name={field.name}
                      id={field.name}
                      value={field.state.value ?? ''}
                      aria-invalid={
                        field.state.meta.isTouched &&
                        field.state.meta.errors?.length > 0
                      }
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldInfo fieldMeta={field.state.meta} />
                  </div>
                )}
              </form.Field>
            </div>
            <div className="">
              <form.Field
                name="outputDir"
                validators={{
                  onBlur: baseValidationSchema.shape.outputDir,
                }}
              >
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Output Directory
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="text"
                      className="form-input"
                      name={field.name}
                      id={field.name}
                      value={field.state.value}
                      aria-invalid={
                        field.state.meta.isTouched &&
                        field.state.meta.errors?.length > 0
                      }
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldInfo fieldMeta={field.state.meta} />
                  </div>
                )}
              </form.Field>
            </div>
            <div className="form-field-switches col-span-2 gap-x-12">
              <form.Field name="skipRecheck">
                {(field) => {
                  return (
                    <div className="form-field__switch flex items-center">
                      <Label htmlFor={field.name} className="mr-3">
                        Skip Recheck
                      </Label>
                      <Switch
                        id={field.name}
                        className="data-[state='checked']:!bg-accent focus-visible:border-accent-700 focus-visible:ring-accent-300 shadow-none"
                        checked={field.state.value}
                        onCheckedChange={field.handleChange}
                      />
                    </div>
                  );
                }}
              </form.Field>
              <form.Field name="useClientTorrents">
                {(field) => {
                  return (
                    <div className="form-field__switch flex items-center">
                      <Label htmlFor={field.name} className="mr-3">
                        Use Client Torrents
                      </Label>
                      <Switch
                        id={field.name}
                        className="data-[state='checked']:!bg-accent focus-visible:border-accent-700 focus-visible:ring-accent-300 shadow-none"
                        checked={field.state.value}
                        onCheckedChange={field.handleChange}
                      />
                    </div>
                  );
                }}
              </form.Field>
              <form.Field name="duplicateCategories">
                {(field) => {
                  return (
                    <div className="form-field__switch flex items-center">
                      <Label htmlFor={field.name} className="mr-3">
                        Duplicate Categories
                      </Label>
                      <Switch
                        id={field.name}
                        className="data-[state='checked']:!bg-accent focus-visible:border-accent-700 focus-visible:ring-accent-300 shadow-none"
                        checked={field.state.value}
                        onCheckedChange={field.handleChange}
                      />
                    </div>
                  );
                }}
              </form.Field>
            </div>
          </fieldset>
          <fieldset className="form-fieldset w-full gap-6 rounded-md">
            <legend>Searching and RSS</legend>

            {/* TODO: Error states or validations don't seem to work for these fields */}

            <div className="">
              <form.Field
                name="delay"
                validators={{
                  onBlur: baseValidationSchema.shape.delay,
                }}
              >
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Delay
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="number"
                      className="form-input"
                      name={field.name}
                      id={field.name}
                      placeholder="30"
                      value={field.state.value}
                      aria-invalid={
                        field.state.meta.isTouched &&
                        field.state.meta.errors?.length > 0
                      }
                      onBlur={field.handleBlur}
                      onChange={(e) =>
                        field.handleChange(Number(e.target.value))
                      }
                    />
                    <FieldInfo fieldMeta={field.state.meta} />
                  </div>
                )}
              </form.Field>
            </div>
            <div className="">
              <form.Field name="matchMode">
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Match Mode
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Select
                      name={field.name}
                      defaultValue={field.state.value}
                      onValueChange={(e) => field.handleChange(e as MatchMode)}
                    >
                      <SelectTrigger className="focus-visible:ring-accent-300/40 border-slate-300 bg-white shadow-none">
                        <SelectValue placeholder="Select a link type" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.keys(MatchMode).map((key) => (
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
                  </div>
                )}
              </form.Field>
            </div>
            <div className="">
              <form.Field
                name="rssCadence"
                validators={{
                  onBlur: baseValidationSchema.shape.rssCadence,
                }}
              >
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      RSS Cadence
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="text"
                      className="form-input"
                      name={field.name}
                      id={field.name}
                      placeholder="15 minutes"
                      value={field.state.value ?? ''}
                      aria-invalid={
                        field.state.meta.isTouched &&
                        field.state.meta.errors?.length > 0
                      }
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldInfo fieldMeta={field.state.meta} />
                  </div>
                )}
              </form.Field>
            </div>
            <div className="">
              <form.Field
                name="searchCadence"
                validators={{
                  onBlur: baseValidationSchema.shape.searchCadence,
                }}
              >
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Search Cadence
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="text"
                      className="form-input"
                      name={field.name}
                      id={field.name}
                      placeholder="1 day"
                      value={field.state.value ?? ''}
                      aria-invalid={
                        field.state.meta.isTouched &&
                        field.state.meta.errors?.length > 0
                      }
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldInfo fieldMeta={field.state.meta} />
                  </div>
                )}
              </form.Field>
            </div>
            <div className="">
              <form.Field
                name="snatchTimeout"
                validators={{
                  onBlur: baseValidationSchema.shape.snatchTimeout,
                }}
              >
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Snatch Timeout
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="text"
                      className="form-input"
                      name={field.name}
                      id={field.name}
                      value={field.state.value ?? ''}
                      aria-invalid={
                        field.state.meta.isTouched &&
                        field.state.meta.errors?.length > 0
                      }
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldInfo fieldMeta={field.state.meta} />
                  </div>
                )}
              </form.Field>
            </div>
            <div className="">
              <form.Field
                name="searchTimeout"
                validators={{
                  onBlur: baseValidationSchema.shape.searchTimeout,
                }}
              >
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Search Timeout
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="text"
                      className="form-input"
                      name={field.name}
                      id={field.name}
                      value={field.state.value ?? ''}
                      aria-invalid={
                        field.state.meta.isTouched &&
                        field.state.meta.errors?.length > 0
                      }
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldInfo fieldMeta={field.state.meta} />
                  </div>
                )}
              </form.Field>
            </div>
            <div className="">
              <form.Field
                name="searchLimit"
                validators={{
                  onBlur: baseValidationSchema.shape.searchLimit,
                }}
              >
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Search Limit
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="number"
                      className="form-input"
                      name={field.name}
                      id={field.name}
                      value={field.state.value ?? ''}
                      aria-invalid={
                        field.state.meta.isTouched &&
                        field.state.meta.errors?.length > 0
                      }
                      onBlur={field.handleBlur}
                      onChange={(e) =>
                        field.handleChange(Number(e.target.value))
                      }
                    />
                    <FieldInfo fieldMeta={field.state.meta} />
                  </div>
                )}
              </form.Field>
            </div>
            <div className="">
              <form.Field
                name="excludeOlder"
                validators={{
                  onBlur: baseValidationSchema.shape.excludeOlder,
                }}
              >
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Exclude Older
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="text"
                      className="form-input"
                      name={field.name}
                      id={field.name}
                      placeholder="2 weeks"
                      value={field.state.value ?? ''}
                      aria-invalid={
                        field.state.meta.isTouched &&
                        field.state.meta.errors?.length > 0
                      }
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldInfo fieldMeta={field.state.meta} />
                  </div>
                )}
              </form.Field>
            </div>
            <div className="">
              <form.Field
                name="excludeRecentSearch"
                validators={{
                  onBlur: baseValidationSchema.shape.excludeRecentSearch,
                }}
              >
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Exclude Recent Search
                    </Label>
                    <Input
                      type="text"
                      className="form-input"
                      name={field.name}
                      id={field.name}
                      placeholder="3 days"
                      value={field.state.value ?? ''}
                      aria-invalid={
                        field.state.meta.isTouched &&
                        field.state.meta.errors?.length > 0
                      }
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldInfo fieldMeta={field.state.meta} />
                  </div>
                )}
              </form.Field>
            </div>
          </fieldset>
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
                      className="data-[state='checked']:!bg-accent focus-visible:border-accent-700 focus-visible:ring-accent-300 shadow-none"
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
                      className="data-[state='checked']:!bg-accent focus-visible:border-accent-700 focus-visible:ring-accent-300 shadow-none"
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
                validators={{
                  onBlur: baseValidationSchema.shape.blockList,
                  onChange: baseValidationSchema.shape.blockList,
                }}
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
                              <form.Field
                                name={`blockList[${index}]`}
                                validators={{
                                  onBlur: z.string(),
                                }}
                              >
                                {(subfield) => {
                                  return (
                                    <>
                                      <div className="flex items-center gap-2">
                                        <Input
                                          type="text"
                                          className="form-input"
                                          id={`${field.name}-${index}`}
                                          value={subfield.state.value ?? ''}
                                          aria-invalid={
                                            !!(
                                              subfield.state.meta.isTouched &&
                                              (
                                                subfield.state.meta.errorMap
                                                  .onBlur as string
                                              )?.length > 0
                                            )
                                          }
                                          onBlur={subfield.handleBlur}
                                          onChange={(e) =>
                                            subfield.handleChange(
                                              e.target.value,
                                            )
                                          }
                                        />
                                        {field.state.value &&
                                          field.state.value.length > 1 && (
                                            <Button
                                              onClick={() =>
                                                field.removeValue(index)
                                              }
                                              className="rounded border border-red-500/30 bg-transparent text-red-500/30 shadow-none transition-all duration-150 outline-none hover:bg-red-500 hover:text-white focus:bg-red-500 focus:text-white focus-visible:border-red-500 focus-visible:ring-red-300/40"
                                            >
                                              <FontAwesomeIcon icon={faTrash} />
                                            </Button>
                                          )}
                                      </div>
                                      {/* <FieldInfo field={subfield} /> */}
                                    </>
                                  );
                                }}
                              </form.Field>
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
                        className="focus-visible:ring-accent-300/40 h-auto rounded border border-slate-500 bg-slate-200 px-2.5 py-1.5 text-slate-800 shadow-none transition-colors duration-150 hover:bg-slate-100 disabled:opacity-35"
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
            <div className="sticky right-0 bottom-0 left-0 -mx-4 border-t border-solid border-slate-200 bg-slate-50 p-6 dark:bg-slate-900">
              <Button
                type="submit"
                className="!bg-accent hover:!bg-accent-500 dark:bg-accent-800 w-full rounded-md px-4 py-6 text-white transition-colors duration-150 disabled:bg-slate-300 disabled:opacity-60"
                disabled={!canSubmit}
              >
                {isSubmitting ? 'Saving...' : 'Save'} "
                {canSubmit && 'can submit'}"
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
              className="w-lg overflow-auto bg-white p-4 shadow-lg dark:bg-slate-800 dark:text-white"
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
