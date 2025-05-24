import { withForm } from '@/hooks/form';
// import { Config } from '@/types/config';
// import { defaultConfig } from '../../../../shared/constants';
import defaultValues from '@/hooks/use-config-form';

const ConnectCrossSeedFields = withForm({
  ...defaultValues,
  render: ({ form }) => {
    return (
      <fieldset className="form-fieldset w-full gap-6 rounded-md">
        <legend>Connect to Cross Seed</legend>
        <div>
          <form.AppField
            name="host"
            validators={
              {
                // onBlur: validationSchema.shape.host,
              }
            }
          >
            {(field) => <field.TextField label="Host" />}
          </form.AppField>
        </div>
        <div className="">
          <form.AppField
            name="port"
            validators={
              {
                // onBlur: validationSchema.shape.port,
              }
            }
          >
            {(field) => <field.TextField label="Port" type="number" />}
          </form.AppField>
        </div>
        <div className="">
          <form.AppField
            name="apiKey"
            validators={
              {
                // onBlur: validationSchema.shape.apiKey,
              }
            }
          >
            {(field) => <field.TextField label="API Key" />}
          </form.AppField>
        </div>
      </fieldset>
    );
  },
});

export default ConnectCrossSeedFields;
