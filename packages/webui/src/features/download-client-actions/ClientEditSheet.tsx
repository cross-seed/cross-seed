import { useState } from 'react';
import { useTRPC } from '@/lib/trpc';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetFooter,
  SheetTitle,
} from '@/components/ui/sheet';
import { TestTube, Loader2 } from 'lucide-react';
import { useAppForm } from '@/hooks/form';
import { formOpts } from '@/components/Form/shared-form';
import { clientValidationSchema } from '@/types/config';
import { useSaveConfigHook } from '@/hooks/saveFormHook';
import useConfigForm from '@/hooks/use-config-form';
import { FormValidationProvider } from '@/contexts/Form/form-validation-provider';
import {
  getHostFromClientUrl,
  getProtocolFromClientUrl,
  buildClientUrl,
  buildClientTestUrl,
} from './lib/urls';
import { TDownloadClient } from '@/types/download-clients';
import { testConnection } from '@/lib/test-connection';
// import { Label as Labels } from '../../../../../src/logger';

interface ClientEditSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'edit' | 'create';
  client: TDownloadClient | null;
}

const CLIENTS = {
  qbittorrent: 'qBittorrent',
  rtorrent: 'rTorrent',
  transmission: 'Transmission',
  deluge: 'Deluge',
};

export default function ClientEditSheet({
  open,
  onOpenChange,
  mode,
  client,
}: ClientEditSheetProps) {
  const [isTesting, setIsTesting] = useState(false);
  const { isFieldRequired } = useConfigForm(clientValidationSchema);

  // Get existing clients to compare against when saving
  const trpc = useTRPC();
  const { data: existingClients } = useQuery(
    trpc.settings.get.queryOptions(undefined, {
      select: (data) => data.config.torrentClients || [],
    }),
  );

  const { saveConfig, isLoading: isSaving } = useSaveConfigHook();

  const form = useAppForm({
    ...formOpts,
    defaultValues: client ?? {},
    onSubmit: async ({ value }) => {
      // Full schema validation
      try {
        const sanitizedValue = {
          ...value,
          readOnly: value?.readOnly ?? false,
        };
        const result = clientValidationSchema.safeParse(sanitizedValue);
        if (!result.success) {
          console.error('FULL VALIDATION FAILED:', result.error.format());
          throw new Error('Validation failed');
        } else {
          // build url first
          const validatedData = result.data;
          const protocol = getProtocolFromClientUrl(validatedData.url);
          const host = getHostFromClientUrl(validatedData.url);
          const clientString = buildClientUrl({
            client: validatedData.client,
            protocol,
            host,
            username: validatedData.user ?? '',
            password: validatedData.password ?? '',
            readonly: validatedData.readOnly,
            // * TODO: add usePlugin for rtorrent clients
          });

          let updatedClients: string[];
          if (mode === 'edit' && client && client.index !== undefined) {
            updatedClients = [...(existingClients || [])];
            updatedClients[client.index] = clientString;
          } else {
            updatedClients = [...(existingClients || []), clientString];
          }

          saveConfig({ torrentClients: updatedClients });
          onOpenChange(false);
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
      onSubmit: clientValidationSchema,
    },
  });

  const handleTest = async () => {
    setIsTesting(true);
    const client = String(form.getFieldValue('client'));
    const url = String(form.getFieldValue('url'));
    const username = String(form.getFieldValue('user') || '');
    const password = String(form.getFieldValue('password') || '');

    const testUrl = buildClientTestUrl({
      client,
      protocol: getProtocolFromClientUrl(url),
      host: getHostFromClientUrl(url),
      username,
      password,
    });
    const result = await testConnection({
      client,
      url: testUrl,
      username,
      password,
      plugin: false,
    });
    if (result.success) {
      toast.success('Connection successful!', {
        description: 'The torrent client connection was successful.',
      });
      setIsTesting(false);
    } else {
      toast.error('Connection failed', {
        description: 'Failed to connect to the torrent client.',
      });
      setIsTesting(false);
    }
  };

  const isLoading = isSaving || isTesting;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <FormValidationProvider isFieldRequired={isFieldRequired}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
          >
            <SheetHeader>
              <SheetTitle>
                {mode === 'edit' ? 'Edit Client' : 'Create Client'}
              </SheetTitle>
              <SheetDescription>
                {mode === 'edit'
                  ? 'Edit the details of the torrent client.'
                  : 'Create a new torrent client.'}
              </SheetDescription>
            </SheetHeader>

            <div className="grid flex-1 auto-rows-min gap-6 px-4">
              <div className="grid gap-3">
                <form.AppField name="client">
                  {(field) => (
                    <>
                      <field.SelectField label="Client" options={CLIENTS} />
                      {field.state.value === CLIENTS.rtorrent.toLowerCase() && (
                        <form.AppField name="plugin">
                          {(field) => (
                            <field.SwitchField label="Use Plugin URL" />
                          )}
                        </form.AppField>
                      )}
                    </>
                  )}
                </form.AppField>
              </div>

              <div className="grid gap-3">
                <form.AppField name="url">
                  {(field) => <field.TextField label="Client URL" />}
                </form.AppField>
              </div>

              <div className="grid gap-3">
                <form.AppField name="user">
                  {(field) => <field.TextField label="User" />}
                </form.AppField>
              </div>

              <div className="grid gap-3">
                <form.AppField name="password">
                  {(field) => (
                    <field.TextField label="Password" type="password" />
                  )}
                </form.AppField>
              </div>

              <div className="grid gap-3">
                <form.AppField name="readOnly">
                  {(field) => <field.SwitchField label="Read only" />}
                </form.AppField>
              </div>

              <form.Subscribe
                selector={(state) => ({
                  urlValue: state.values.url,
                  urlMeta: state.fieldMeta.url,
                  userValue: state.values.user,
                  userMeta: state.fieldMeta.user,
                  passwordValue: state.values.password,
                  passwordMeta: state.fieldMeta.password,
                  clientValue: state.values.client,
                })}
              >
                {({
                  urlValue,
                  urlMeta,
                  userValue,
                  userMeta,
                  passwordValue,
                  passwordMeta,
                  clientValue,
                }) => {
                  // Determine if test button should be enabled
                  const urlValid = urlValue && !urlMeta?.errors?.length;
                  const passwordValid =
                    clientValue === 'transmission' &&
                    passwordValue === undefined
                      ? true
                      : passwordValue && !passwordMeta?.errors?.length;
                  const userValid =
                    clientValue === 'deluge' || clientValue === 'transmission'
                      ? true
                      : userValue && !userMeta?.errors?.length;

                  const canTest = urlValid && passwordValid && userValid;
                  return (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleTest}
                        disabled={!canTest}
                        className="w-full"
                      >
                        {isTesting ? (
                          <>
                            <Loader2 className="animate-spin" />
                            Testing connection...
                          </>
                        ) : (
                          <>
                            <TestTube className="mr-2" />
                            Test Connection
                          </>
                        )}
                      </Button>
                      {clientValue === 'qbittorrent' && (
                        <p className="text-muted-foreground -mt-4 px-2 text-sm italic">
                          Note: Testing connections can return false positives
                          if{' '}
                          <code className="bg-yellow-100 px-1">
                            Bypass auth on localhost
                          </code>{' '}
                          is enabled in qBittorrent.
                        </p>
                      )}
                    </>
                  );
                }}
              </form.Subscribe>
            </div>

            <SheetFooter className="mt-6">
              <form.AppForm>
                <form.SubmitButton
                  label={mode === 'edit' ? 'Update' : 'Create'}
                  actionLabel={mode === 'edit' ? 'Updating...' : 'Creating...'}
                />
              </form.AppForm>
              <SheetClose asChild>
                <Button type="button" variant="outline" disabled={isLoading}>
                  Cancel
                </Button>
              </SheetClose>
            </SheetFooter>
          </form>
        </FormValidationProvider>
      </SheetContent>
    </Sheet>
  );
}
