import { withForm } from '@/hooks/form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { FieldInfo } from '@/components/Form/FieldInfo';
import { useState, useEffect } from 'react';

// Define the props that will be passed to the component
type MiscSettingsFieldsProps = {
  onFieldAdded?: (fieldId: string) => void;
  isFieldRequired?: (fieldName: string) => boolean;
};

const MiscSettingsFields = withForm({
  render: ({ form }, props: MiscSettingsFieldsProps = {}) => {
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
        <legend>Misc. Settings</legend>
        <form.AppField name="includeNonVideos">
          {(field) => <field.SwitchField label="Include Non-Videos" />}
        </form.AppField>
        <form.AppField name="includeSingleEpisodes">
          {(field) => <field.SwitchField label="Include Single Episodes" />}
        </form.AppField>
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
                    {fieldRequired(field.name) && (
                      <span className="pl-1 text-red-500">*</span>
                    )}
                  </Label>
                  {field.state.value &&
                    (field.state.value.length ? field.state.value : ['']).map(
                      (_: string, index: number) => {
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
                      },
                    )}
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

export default MiscSettingsFields;
