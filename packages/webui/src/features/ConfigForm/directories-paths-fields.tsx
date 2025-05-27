import { withForm } from '@/hooks/form';
import { LinkType } from '../../../../shared/constants';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { FieldInfo } from '@/components/Form/FieldInfo';
import { useState, useEffect } from 'react';

type DirectoriesPathsFieldsProps = {
  onFieldAdded?: (fieldId: string) => void;
  isFieldRequired?: (fieldName: string) => boolean;
};

const DirectoriesPathsFields = withForm({
  render: function Render({ form }, props: DirectoriesPathsFieldsProps = {}) {
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
                    {fieldRequired(field.name) && (
                      <span className="pl-1 text-red-500">*</span>
                    )}
                  </Label>
                  {field.state.value &&
                    field.state.value.map((_: string, index: number) => {
                      return (
                        <div key={index} className="gap-y- mb-3 flex flex-col">
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
                      if (field.state.value?.length) {
                        setLocalLastFieldAdded(
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
          <form.AppField
            name="linkType"
            validators={
              {
                // onChange: baseValidationSchema.shape.linkType,
              }
            }
          >
            {(field) => (
              <field.SelectField label="Link Type" options={LinkType} />
            )}
            {/* <div className="space-y-3"> */}
            {/*   <Label htmlFor={field.name} className="block w-full"> */}
            {/*     Link Type */}
            {/*     {fieldRequired(field.name) && ( */}
            {/*       <span className="pl-1 text-red-500">*</span> */}
            {/*     )} */}
            {/*   </Label> */}
            {/*   <Select */}
            {/*     name={field.name} */}
            {/*     defaultValue={field.state.value} */}
            {/*     onValueChange={(e) => field.handleChange(e as LinkType)} */}
            {/*   > */}
            {/*     <SelectTrigger className="w-full shadow-none"> */}
            {/*       <SelectValue placeholder="Select a link type" /> */}
            {/*     </SelectTrigger> */}
            {/*     <SelectContent> */}
            {/*       {Object.keys(LinkType).map((key) => ( */}
            {/*         <SelectItem */}
            {/*           key={key.toLowerCase()} */}
            {/*           value={key.toLowerCase()} */}
            {/*         > */}
            {/*           {key.toLowerCase()} */}
            {/*         </SelectItem> */}
            {/*       ))} */}
            {/*     </SelectContent> */}
            {/*   </Select> */}
            {/*   <FieldInfo fieldMeta={field.state.meta} /> */}
            {/*   {field.state.value} */}
            {/* </div> */}
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
                    {fieldRequired(field.name) && (
                      <span className="pl-1 text-red-500">*</span>
                    )}
                  </Label>
                  {field.state.value?.map((_: string, index: number) => {
                    return (
                      <div key={index} className="gap-y- mb-3 flex flex-col">
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

export default DirectoriesPathsFields;
