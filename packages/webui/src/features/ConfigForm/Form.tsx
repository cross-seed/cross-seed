import { Button } from '@/components/ui/button';
import { useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { baseValidationSchema, Config } from '@/types/config';
import { useQuery } from '@tanstack/react-query';
import { FC, useEffect, useState } from 'react';
import './Form.css';
import { defaultConfig } from '../../../../shared/constants';
import { useAppForm } from '@/hooks/form';
import { formatConfigDataForForm } from './lib/formatConfigData';
import { removeEmptyArrayValues } from './lib/transformers';
import { LoaderCircle } from 'lucide-react';
import DirectoriesPathsFields from './directories-paths-fields';
import ConnectCrossSeedFields from './connect-crossseed-fields';
import DownloadingFields from './downloading-fields';
import SearchingRssFields from './searching-rss-fields';
import MiscSettingsFields from './misc-settings-fields';
import ConnectOtherAppsFields from './connect-other-apps-fields';
// import useConfigForm from '@/hooks/use-config-form';
import { useSaveConfigHook } from './hooks/saveFormHook';

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

  const {
    saveConfig,
    // isLoading: isSaving,
    // isError: isSaveError,
  } = useSaveConfigHook();

  // const { config: configData, validationSchema: baseValidationSchema } =
  //   useConfigForm();

  const form = useAppForm({
    defaultValues: configData ?? defaultConfig,
    onSubmit: async ({ value }) => {
      // Full schema validation
      // Fake a long response delay
      // setTimeout(() => {
      try {
        const result = baseValidationSchema.safeParse(value);
        if (!result.success) {
          console.error('FULL VALIDATION FAILED:', result.error.format());
        } else {
          // remove empty values from array fields
          Object.keys(value).forEach((attr) => {
            const val = value[attr as keyof typeof configData];
            if (val && Array.isArray(val)) {
              (value[attr as keyof typeof configData] as unknown) =
                removeEmptyArrayValues(val);
            }
          });

          saveConfig(value);
        }
      } catch (err) {
        console.error('Exception during full validation:', err);
        return {
          status: 'error',
          error: {
            _form: 'An unexpected error occurred during validation',
          },
        };
      }
      // }, 2000);
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
          {/* Directories and Paths */}
          <DirectoriesPathsFields
            form={form}
            isFieldRequired={isFieldRequired}
            onFieldAdded={setLastFieldAdded}
          />

          {/* Connecting to Other Apps */}
          <ConnectOtherAppsFields
            form={form}
            isFieldRequired={isFieldRequired}
            onFieldAdded={setLastFieldAdded}
          />

          {/* Connect to Cross Seed  */}
          <ConnectCrossSeedFields form={form} />

          {/* Downloading */}
          <DownloadingFields form={form} />

          {/* Searching & RSS */}
          <SearchingRssFields form={form} />

          {/* Misc. Settings */}
          <MiscSettingsFields
            form={form}
            isFieldRequired={isFieldRequired}
            onFieldAdded={setLastFieldAdded}
          />
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
