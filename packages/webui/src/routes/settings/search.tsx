import { MatchMode } from '../../../../shared/constants';
import { formOpts } from '../../components/Form/shared-form';
import { useAppForm } from '@/hooks/form';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc';
import { formatConfigDataForForm } from '@/lib/formatConfigData';
import { searchValidationSchema } from '@/types/config';
import useConfigForm from '@/hooks/use-config-form';
import { FormValidationProvider } from '@/contexts/Form/form-validation-provider';
import { pickSchemaFields } from '@/lib/pick-schema-fields';
import { createFileRoute } from '@tanstack/react-router';
import { Page } from '@/components/Page';
import { useSettingsFormSubmit } from '@/hooks/use-settings-form-submit';

function SearchRssSettings() {
  const trpc = useTRPC();
  const { isFieldRequired } = useConfigForm(searchValidationSchema);
  const { data: configData } = useQuery(
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

  const handleSubmit = useSettingsFormSubmit();

  const form = useAppForm({
    ...formOpts,
    defaultValues: configData ?? formOpts.defaultValues,
    onSubmit: handleSubmit,
    validators: {
      onSubmit: searchValidationSchema,
    },
  });

  return (
    <Page>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Search & RSS Settings</h1>
          <p className="text-muted-foreground">
            Manage search and RSS options.
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
                      <field.SelectField
                        label="Match Mode"
                        options={MatchMode}
                      />
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
                    {(field) => <field.DurationField label="RSS Cadence" />}
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
                    {(field) => <field.DurationField label="Search Cadence" />}
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
                    {(field) => <field.DurationField label="Search Timeout" />}
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
                    {(field) => <field.DurationField label="Exclude Older" />}
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
                    {(field) => (
                      <field.DurationField label="Exclude Recent Search" />
                    )}
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

export const Route = createFileRoute('/settings/search')({
  component: SearchRssSettings,
});
