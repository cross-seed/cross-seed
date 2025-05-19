import { withForm } from '@/hooks/form';
import { MatchMode } from '../../../../shared/constants';

const SearchingRssFields = withForm({
  // ...defaultValues,
  render: ({ form }) => {
    return (
      <fieldset className="form-fieldset w-full gap-6 rounded-md">
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
            name="snatchTimeout"
            validators={
              {
                // onBlur: baseValidationSchema.shape.snatchTimeout,
              }
            }
          >
            {(field) => <field.TextField label="Snatch Timeout" />}
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
            {(field) => <field.TextField label="Search Limit" type="number" />}
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
    );
  },
});

export default SearchingRssFields;
