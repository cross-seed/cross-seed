import { withForm } from '@/hooks/form';
import { MatchMode } from '../../../../shared/constants';
import { formOpts } from '../../components/Form/shared-form';
import { useAppForm } from '@/hooks/form';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc';
import { formatConfigDataForForm } from '@/lib/formatConfigData';
import { useSaveConfigHook } from '@/hooks/saveFormHook';
import { removeEmptyArrayValues } from '@/lib/transformers';
import { searchValidationSchema } from '@/types/config';
import useConfigForm from '@/hooks/use-config-form';
import { FormValidationProvider } from '@/contexts/Form/form-validation-provider';
import { pickSchemaFields } from '@/lib/pick-schema-fields';

const SearchRssSettings = withForm({
  ...formOpts,
  render: function Render() {
    const trpc = useTRPC();
    const { isFieldRequired } = useConfigForm(searchValidationSchema);
    const {
      data: configData,
      // isLoading,
      // isError,
    } = useQuery(
      trpc.settings.get.queryOptions(undefined, {
        select: (data) => {
          const fullDataset = formatConfigDataForForm(data.config);
          const filteredData = pickSchemaFields(
            searchValidationSchema,
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
          const result = searchValidationSchema.safeParse(value);
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
        onSubmit: searchValidationSchema,
      },
    });

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
              <legend>Searching and RSS</legend>

              {/* TODO: Error states or validations don't seem to work for these fields */}

              <div className="">
                <form.AppField
                  name="delay"
                  validators={
                    {
                      // onBlur: baseValidationSchema.shape.delay,
                    }
                  }
                >
                  {(field) => <field.TextField label="Delay" type="number" />}
                </form.AppField>
              </div>
              <div className="">
                <form.AppField name="matchMode">
                  {(field) => (
                    <field.SelectField label="Match Mode" options={MatchMode} />
                  )}
                </form.AppField>
              </div>
              <div className="">
                <form.AppField
                  name="rssCadence"
                  validators={
                    {
                      // onBlur: baseValidationSchema.shape.rssCadence,
                    }
                  }
                >
                  {(field) => <field.TextField label="RSS Cadence" />}
                </form.AppField>
              </div>
              <div className="">
                <form.AppField
                  name="searchCadence"
                  validators={
                    {
                      // onBlur: baseValidationSchema.shape.searchCadence,
                    }
                  }
                >
                  {(field) => <field.TextField label="Search Cadence" />}
                </form.AppField>
              </div>
              <div className="">
                <form.AppField
                  name="searchTimeout"
                  validators={
                    {
                      // onBlur: baseValidationSchema.shape.searchTimeout,
                    }
                  }
                >
                  {(field) => <field.TextField label="Search Timeout" />}
                </form.AppField>
              </div>
              <div className="">
                <form.AppField
                  name="searchLimit"
                  validators={
                    {
                      // onBlur: baseValidationSchema.shape.searchLimit,
                    }
                  }
                >
                  {(field) => (
                    <field.TextField label="Search Limit" type="number" />
                  )}
                </form.AppField>
              </div>
              <div className="">
                <form.AppField
                  name="excludeOlder"
                  validators={
                    {
                      // onBlur: baseValidationSchema.shape.excludeOlder,
                    }
                  }
                >
                  {(field) => <field.TextField label="Exclude Older" />}
                </form.AppField>
              </div>
              <div className="">
                <form.AppField
                  name="excludeRecentSearch"
                  validators={
                    {
                      // onBlur: baseValidationSchema.shape.excludeRecentSearch,
                    }
                  }
                >
                  {(field) => <field.TextField label="Exclude Recent Search" />}
                </form.AppField>
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

export default SearchRssSettings;
