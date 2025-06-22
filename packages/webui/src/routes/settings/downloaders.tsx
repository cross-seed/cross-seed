import { withForm } from '@/hooks/form';
import { Separator } from '@/components/ui/separator';
import { Action } from '../../../../shared/constants';
import { useEffect, useState } from 'react';
import useConfigForm from '@/hooks/use-config-form';
import { formOpts } from '@/components/Form/shared-form';
import { useAppForm } from '@/hooks/form';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc';
import { formatConfigDataForForm } from '@/lib/formatConfigData';
import { useSaveConfigHook } from '@/hooks/saveFormHook';
import { removeEmptyArrayValues } from '@/lib/transformers';
import { downloaderValidationSchema } from '@/types/config';
import { FormValidationProvider } from '@/contexts/Form/form-validation-provider';
import { pickSchemaFields } from '@/lib/pick-schema-fields';
import { toast } from 'sonner';
import { createFileRoute } from '@tanstack/react-router';
import { SettingsLayout } from '@/components/SettingsLayout';

const DownloadersFields = withForm({
  ...formOpts,
  render: function Render() {
    const trpc = useTRPC();
    const { isFieldRequired } = useConfigForm(downloaderValidationSchema);
    const {
      data: configData,
      // isLoading,
      // isError,
    } = useQuery(
      trpc.settings.get.queryOptions(undefined, {
        select: (data) => {
          const fullDataset = formatConfigDataForForm(data.config);
          const filteredData = pickSchemaFields(
            downloaderValidationSchema,
            fullDataset,
            { includeUndefined: true },
          );

          return filteredData;
        },
      }),
    );

    const {
      saveConfig,
      isSuccess,
      // isLoading: isSaving,
      // isError: isSaveError,
    } = useSaveConfigHook();

    const form = useAppForm({
      ...formOpts,
      defaultValues: configData ?? formOpts.defaultValues,
      onSubmit: async ({ value }) => {
        // Full schema validation
        try {
          const result = downloaderValidationSchema.safeParse(value);
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
      },
      validators: {
        onSubmit: downloaderValidationSchema,
      },
    });

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

    useEffect(() => {
      if (isSuccess) {
          toast.success('Configuration saved successfully!', {
            description: 'Your changes will take effect on the next restart.',
          });
      }
    }, [isSuccess]);

    return (
      <SettingsLayout>
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
              <legend>Downloading</legend>
              <p className="text-muted-foreground col-span-2 text-sm">
                Choose one client application to use for downloading and add its
                details here.
              </p>
              <div>
                <form.AppField
                  name="rtorrentRpcUrl"
                  validators={
                    {
                      // onBlur: baseValidationSchema.shape.rtorrentRpcUrl,
                    }
                  }
                >
                  {(field) => (
                    <>
                      <field.TextField
                        label="rTorrent RPC URL"
                        type="url"
                        placeholder="http://username:password@localhost:1234/RPC2"
                        required={false}
                      />
                    </>
                  )}
                </form.AppField>
              </div>
              <div>
                <form.AppField
                  name="qbittorrentUrl"
                  validators={
                    {
                      // onBlur: baseValidationSchema.shape.qbittorrentUrl,
                    }
                  }
                >
                  {(field) => (
                    <field.TextField
                      label="qBittorrent URL"
                      type="url"
                      placeholder="http://username:password@localhost:8080"
                      required={false}
                    />
                  )}
                </form.AppField>
              </div>
              <div>
                <form.AppField
                  name="transmissionRpcUrl"
                  validators={
                    {
                      // onBlur: baseValidationSchema.shape.transmissionRpcUrl,
                    }
                  }
                >
                  {(field) => (
                    <field.TextField
                      label="Transmission RPC URL"
                      type="url"
                      placeholder="http://username:password@localhost:9091/transmission/rpc"
                      required={false}
                    />
                  )}
                </form.AppField>
              </div>
              <div>
                <form.AppField
                  name="delugeRpcUrl"
                  validators={
                    {
                      // onBlur: baseValidationSchema.shape.delugeRpcUrl,
                    }
                  }
                >
                  {(field) => (
                    <field.TextField
                      label="Deluge RPC URL"
                      type="url"
                      placeholder="http://:password@localhost:8112/json"
                      required={false}
                    />
                  )}
                </form.AppField>
              </div>
              <Separator className="col-span-2 my-5" />
              <div className="">
                <form.AppField name="action">
                  {(field) => (
                    <field.SelectField label="Action" options={Action} />
                  )}
                </form.AppField>
              </div>
              <div className="">
                <form.AppField
                  name="linkCategory"
                  validators={
                    {
                      // onBlur: baseValidationSchema.shape.linkCategory,
                    }
                  }
                >
                  {(field) => (
                    <field.TextField label="Link Category" required={false} />
                  )}
                </form.AppField>
              </div>
              <div className="">
                <form.AppField
                  name="torrentDir"
                  validators={
                    {
                      // onBlur: baseValidationSchema.shape.torrentDir,
                    }
                  }
                >
                  {(field) => (
                    <field.TextField
                      label="Torrent Directory"
                      required={false}
                    />
                  )}
                </form.AppField>
              </div>
              <div className="">
                <form.AppField
                  name="outputDir"
                  validators={
                    {
                      // onBlur: baseValidationSchema.shape.outputDir,
                    }
                  }
                >
                  {(field) => (
                    <field.TextField
                      label="Output Directory"
                      required={false}
                    />
                  )}
                </form.AppField>
              </div>
              <div className="form-field-switches col-span-2 gap-x-12">
                <form.AppField name="skipRecheck">
                  {(field) => <field.SwitchField label="Skip Recheck" />}
                </form.AppField>
                <form.AppField name="useClientTorrents">
                  {(field) => <field.SwitchField label="Use Client Torrents" />}
                </form.AppField>
                <form.AppField name="duplicateCategories">
                  {(field) => (
                    <field.SwitchField label="Duplicate Categories" />
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
      </SettingsLayout>
    );
  },
});

export const Route = createFileRoute('/settings/downloaders')({
  component: DownloadersFields,
});
