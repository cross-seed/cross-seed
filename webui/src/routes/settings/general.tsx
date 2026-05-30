import { createFileRoute } from '@tanstack/react-router';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { FieldInfo } from '@/components/Form/FieldInfo';
import { useState, useEffect, type SyntheticEvent } from 'react';
import useConfigForm from '@/hooks/use-config-form';
import { defaultGeneralFormValues } from '@/components/Form/shared-form';
import { useAppForm } from '@/hooks/form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc';
import { Input } from '@/components/ui/input';
import DeleteOption from '@/components/Buttons/DeleteOption';
import { formatConfigDataForForm } from '@/lib/formatConfigData';
import { generalValidationSchema } from '@/types/config';
import { FormValidationProvider } from '@/contexts/Form/form-validation-provider';
import { pickSchemaFields } from '@/lib/pick-schema-fields';
import { Page } from '@/components/Page';
import { useSettingsFormSubmit } from '@/hooks/use-settings-form-submit';
import { z } from 'zod';
import { Clipboard, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

type GeneralFormData = z.infer<typeof generalValidationSchema>;

function GeneralSettings() {
  const { isFieldRequired } = useConfigForm(generalValidationSchema);

  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: settingsData } = useQuery(
    trpc.settings.get.queryOptions(undefined),
  );
  const configData = settingsData?.config
    ? pickSchemaFields(
        generalValidationSchema,
        formatConfigDataForForm(settingsData.config),
        { includeUndefined: true },
      )
    : undefined;

  const handleSubmit = useSettingsFormSubmit();

  const form = useAppForm({
    defaultValues: (configData ?? defaultGeneralFormValues) as GeneralFormData,
    onSubmit: handleSubmit,
    validators: {
      onSubmit: generalValidationSchema,
    },
  });

  const [lastFieldAdded, setLastFieldAdded] = useState<string | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  useEffect(() => {
    if (lastFieldAdded) {
      const el = document.getElementById(lastFieldAdded);
      el?.focus();
      setLastFieldAdded(null);
    }
  }, [lastFieldAdded]);

  useEffect(() => {
    if (settingsData?.apiKey) {
      setApiKeyDraft(settingsData.apiKey);
    }
  }, [settingsData?.apiKey]);

  const resetApiKeyMutation = useMutation(
    trpc.settings.resetApiKey.mutationOptions({
      onSuccess: async ({ apiKey }) => {
        setApiKeyDraft(apiKey);
        await queryClient.invalidateQueries({
          queryKey: trpc.settings.get.queryKey(),
          exact: false,
        });
        toast.success('API key regenerated and saved');
      },
      onError: (error) => {
        toast.error('Failed to regenerate API key', {
          description: error.message || 'An unknown error occurred',
        });
      },
    }),
  );

  const selectApiKey = (event: SyntheticEvent<HTMLInputElement>) => {
    event.currentTarget.select();
  };

  const copyApiKey = async () => {
    try {
      await navigator.clipboard.writeText(apiKeyDraft);
      toast.success('API key copied');
    } catch (error) {
      toast.error('Failed to copy API key', {
        description:
          error instanceof Error ? error.message : 'Clipboard unavailable',
      });
    }
  };

  return (
    <Page>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">General Settings</h1>
        </div>
        <FormValidationProvider isFieldRequired={isFieldRequired}>
          <form
            className="form flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void form.handleSubmit();
            }}
            noValidate
          >
            <div className="flex flex-wrap gap-6">
              <fieldset className="form-fieldset w-full gap-6">
                <form.AppField name="includeNonVideos">
                  {(field) => <field.SwitchField label="Include Non-Videos" />}
                </form.AppField>
                <form.AppField name="includeSingleEpisodes">
                  {(field) => (
                    <field.SwitchField label="Include Single Episodes" />
                  )}
                </form.AppField>
                <div className="">
                  <form.AppField name="snatchTimeout" validators={{}}>
                    {(field) => <field.DurationField label="Snatch Timeout" />}
                  </form.AppField>
                </div>
                <div className="">
                  <form.AppField name="fuzzySizeThreshold" validators={{}}>
                    {(field) => (
                      <field.NumberField
                        label="Fuzzy Size Threshold"
                        step="0.01"
                      />
                    )}
                  </form.AppField>
                </div>
                <div className="">
                  <form.AppField name="seasonFromEpisodes" validators={{}}>
                    {(field) => (
                      <field.NumberField label="Season from Episodes" min="0" />
                    )}
                  </form.AppField>
                </div>
                <div className="">
                  <form.AppField name="autoResumeMaxDownload">
                    {(field) => (
                      <field.NumberField label="Auto-resume Max Download" />
                    )}
                  </form.AppField>
                </div>
                <div className="">
                  <form.Field name="blockList" mode="array">
                    {(field) => (
                      <div className="space-y-3">
                        <Label htmlFor={field.name} className="block w-full">
                          Block List
                          {isFieldRequired(field.name) && (
                            <span className="pl-1 text-red-500">*</span>
                          )}
                        </Label>
                        {field.state.value.map(
                          (_value: string, index: number) => (
                            <form.Field
                              key={`${field.name}-${index}`}
                              name={`blockList[${index}]`}
                            >
                              {(subfield) => (
                                <div className="gap-y- mb-3 flex flex-col">
                                  <div className="flex items-center gap-2">
                                    <Input
                                      type="text"
                                      className="form-input"
                                      value={subfield.state.value}
                                      aria-invalid={
                                        !!(
                                          subfield.state.meta.isTouched &&
                                          subfield.state.meta.errorMap.onBlur
                                        )
                                      }
                                      onBlur={subfield.handleBlur}
                                      onChange={(e) =>
                                        subfield.handleChange(e.target.value)
                                      }
                                    />
                                    {field.state.value.length > 1 && (
                                      <DeleteOption
                                        onClick={() => {
                                          field.removeValue(index);
                                        }}
                                      />
                                    )}
                                  </div>

                                  {subfield.state.meta.isTouched &&
                                    subfield.state.meta.errors && (
                                      <FieldInfo
                                        fieldMeta={subfield.state.meta}
                                      />
                                    )}
                                </div>
                              )}
                            </form.Field>
                          ),
                        )}
                        <Button
                          variant="secondary"
                          type="button"
                          onClick={() => {
                            field.pushValue('');
                            setLastFieldAdded(
                              `${field.name}-${field.state.value.length}`,
                            );
                          }}
                          title={`Add ${field.name}`}
                        >
                          Add
                        </Button>
                      </div>
                    )}
                  </form.Field>
                </div>
                <div className="space-y-3">
                  <Label htmlFor="apiKey">API Key</Label>
                  <div className="flex max-w-3xl flex-col gap-2 lg:flex-row">
                    <Input
                      id="apiKey"
                      type="text"
                      value={apiKeyDraft}
                      autoComplete="off"
                      spellCheck={false}
                      readOnly
                      onClick={selectApiKey}
                      onFocus={selectApiKey}
                    />
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!apiKeyDraft}
                        onClick={() => { void copyApiKey(); }}
                      >
                        <Clipboard />
                        Copy
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={resetApiKeyMutation.isPending}
                        onClick={() => resetApiKeyMutation.mutate()}
                      >
                        <RotateCcw />
                        Regenerate & Save
                      </Button>
                    </div>
                  </div>
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

export const Route = createFileRoute('/settings/general')({
  component: GeneralSettings,
});
