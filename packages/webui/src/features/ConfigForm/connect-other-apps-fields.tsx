import { withForm } from '@/hooks/form';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { FieldInfo } from '@/components/Form/FieldInfo';

type ConnectOtherAppsFieldsProps = {
  onFieldAdded?: (fieldId: string) => void;
  isFieldRequired?: (fieldName: string) => boolean;
};

const ConnectOtherAppsFields = withForm({
  render: ({ form }, props: ConnectOtherAppsFieldsProps = {}) => {
    // Local state for tracking the last field added within this component
    const [localLastFieldAdded, setLocalLastFieldAdded] = useState<
      string | null
    >(null);

    // Effect to notify parent component when a field is added
    useEffect(() => {
      if (localLastFieldAdded && props.onFieldAdded) {
        props.onFieldAdded(localLastFieldAdded);
        setLocalLastFieldAdded(null);
      }
    }, [localLastFieldAdded, props]);

    const fieldRequired = (fieldName: string) => {
      return props.isFieldRequired ? props.isFieldRequired(fieldName) : false;
    };

    return (
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
                    {fieldRequired(field.name) && (
                      <span className="pl-1 text-red-500">*</span>
                    )}
                  </Label>
                  {field.state.value.map((_: string, index: number) => {
                    return (
                      <div key={index} className="gap-y- mb-3 flex flex-col">
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
                          {(fieldMeta) => <FieldInfo fieldMeta={fieldMeta} />}
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
                      setLocalLastFieldAdded(newFieldId);
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
                    {fieldRequired(field.name) && (
                      <span className="pl-1 text-red-500">*</span>
                    )}
                  </Label>
                  {field.state.value?.map((_: string, index: number) => {
                    return (
                      <div key={index} className="gap-y- mb-3 flex flex-col">
                        <form.AppField
                          name={`notificationWebhookUrls[${index}]`}
                          validators={{
                            onBlur: z.string().min(3).url().or(z.literal('')),
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
                          {(fieldMeta) => <FieldInfo fieldMeta={fieldMeta} />}
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
                      setLocalLastFieldAdded(newFieldId);
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
                    {fieldRequired(field.name) && (
                      <span className="pl-1 text-red-500">*</span>
                    )}
                  </Label>
                  {field.state.value &&
                    field.state.value.map((_: string, index: number) => {
                      return (
                        <div key={index} className="gap-y- mb-3 flex flex-col">
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
                            {(fieldMeta) => <FieldInfo fieldMeta={fieldMeta} />}
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
                      setLocalLastFieldAdded(newFieldId);
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
                    {fieldRequired(field.name) && (
                      <span className="pl-1 text-red-500">*</span>
                    )}
                  </Label>
                  {field.state.value &&
                    field.state.value.map((_: string, index: number) => {
                      return (
                        <div key={index} className="gap-y- mb-3 flex flex-col">
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
                            {(fieldMeta) => <FieldInfo fieldMeta={fieldMeta} />}
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
                      setLocalLastFieldAdded(newFieldId);
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
    );
  },
});

export default ConnectOtherAppsFields;
