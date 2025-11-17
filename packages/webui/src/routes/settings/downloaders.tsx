import { withForm } from '@/hooks/form';
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
// import { toast } from 'sonner';
import { createFileRoute } from '@tanstack/react-router';
import { Page } from '@/components/Page';
import { Button } from '@/components/ui/button';
import {
  Eye,
  MoreHorizontal,
  Pencil,
  Plus,
  TestTube,
  Trash,
} from 'lucide-react';
import {
  Table,
  TableRow,
  TableHeader,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import ClientViewSheet from '@/features/download-client-actions/ClientViewSheet';
import ClientEditSheet from '@/features/download-client-actions/ClientEditSheet';
import {
  getProtocolFromClientUrl,
  getHostFromClientUrl,
} from '@/features/download-client-actions/lib/urls';

// ! FIXME: consolidate this type in a types.ts file and import it
// Same as the one in ClientEditSheet.tsx
type DownloadClient = {
  name?: string;
  client: string;
  url: string;
  user?: string;
  password: string;
  readOnly?: boolean;
};

const DownloadersFields = withForm({
  ...formOpts,
  render: function Render() {
    const trpc = useTRPC();

    const [clients, setClients] = useState<DownloadClient[] | undefined>(
      undefined,
    );
    const [openDropdown, setOpenDropdown] = useState<string | null>(null);
    const [testingClient, setTestingClient] = useState<string | null>(null);
    const [selectedClient, setSelectedClient] = useState<DownloadClient | null>(
      null,
    );
    const [viewSheetOpen, setViewSheetOpen] = useState(false);
    const [editSheetOpen, setEditSheetOpen] = useState(false);
    const [editMode, setEditMode] = useState<'create' | 'edit'>('create');
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

    // useEffect(() => {
    //   if (isSuccess) {
    //     toast.success('Configuration saved successfully!', {
    //       description: 'Your changes will take effect on the next restart.',
    //     });
    //   }
    // }, [isSuccess]);

    useEffect(() => {
      // Set clients when configData is available
      if (configData?.torrentClients && configData.torrentClients.length > 0) {
        setClients(
          configData.torrentClients.map((client, index) => {
            let clientApp = '';
            let url = '';
            let readOnly = false;
            let user = '';
            let password = '';

            if (typeof client === 'object') {
              clientApp = client.client;
              readOnly = client.readOnly || false;
              url = client.url;
              user = client.user || '';
              password = client.password || '';
            } else if (typeof client === 'string') {
              clientApp = String(client).split(':')[0];
              readOnly = String(client).includes('readonly');
              const firstIndex = String(client).indexOf(':');
              const fullUrl = readOnly
                ? String(client).substring(
                    String(client).indexOf(':', firstIndex + 1) + 1,
                  )
                : String(client).substring(String(client).indexOf(':') + 1);
              url = removeUserAndPassFromClientUrl(fullUrl);
              user = getUserFromClientUrl(fullUrl);
              password = getPassFromClientUrl(fullUrl);
            }

            return {
              index,
              client: clientApp,
              url: url,
              user,
              password,
              readOnly,
            };
          }),
        );
      }
    }, [configData]);

    // * TODO: move to lib
    const removeUserAndPassFromClientUrl = (url: string) => {
      const protocol = getProtocolFromClientUrl(url);
      const host = getHostFromClientUrl(url);
      return `${protocol}//${host}`;
    };

    const getUserFromClientUrl = (url: string) => {
      if (url.includes('@')) {
        const user = url.split('://')[1].split('@')[0];
        if (user.includes(':')) {
          return user.split(':')[0];
        }
        return user.replace(':', '');
      }
      return '';
    };

    const getPassFromClientUrl = (url: string) => {
      if (url.includes('@')) {
        const pass = url.split('://')[1].split('@')[0];
        if (pass.includes(':')) {
          return pass.split(':')[1];
        }
      }
      return '';
    };

    const handleAddDownloader = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setSelectedClient(null);
      setEditMode('create');
      setEditSheetOpen(true);
    };

    const handleViewSheetOpenChange = (open: boolean) => {
      setViewSheetOpen(open);
      if (!open) {
        setOpenDropdown(null);
      }
    };

    const handleViewClient = (e: React.MouseEvent, client: DownloadClient) => {
      e.preventDefault();
      e.stopPropagation();
      setOpenDropdown(null);
      setSelectedClient(client);
      setViewSheetOpen(true);
    };

    const handleEditClient = (client: DownloadClient) => {
      setOpenDropdown(null);
      setSelectedClient(client);
      setEditMode('edit');
      setViewSheetOpen(false);
      setEditSheetOpen(true);
    };

    const handleDeleteClient = (client: DownloadClient) => {
      setOpenDropdown(null);
      const updatedClients = clients?.filter((c) => c.url !== client.url);
      setClients(updatedClients);
      console.log('Deleting client:', client, updatedClients);
      // Delete from the db
      // saveConfig({ torrentClients: [] });
    };

    const handleEditSheetOpenChange = (open: boolean) => {
      setEditSheetOpen(open);
      if (!open) {
        setOpenDropdown(null);
      }
    };

    const addDownloaderButton = (
      <Button onClick={handleAddDownloader} type="button" size="sm">
        <Plus className="mr-2 h-4 w-4" />
        Add Downloader
      </Button>
    );

    return (
      <Page
        breadcrumbs={['Settings', 'Download Clients']}
        actions={addDownloaderButton}
      >
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold">Download Clients</h1>
            <p className="text-muted-foreground">
              Manage your download clients
            </p>
          </div>
          {clients ? (
            <div className="mt-4 mb-7 overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader className="bg-muted sticky top-0 z-10">
                  <TableRow className="border-b">
                    <TableHead>Client</TableHead>
                    <TableHead>RPC URL</TableHead>
                    <TableHead>Read only</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clients?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center">
                        <p className="text-muted-foreground">
                          No download clients configured. Add a client to start
                          downloading.
                        </p>
                      </TableCell>
                    </TableRow>
                  )}
                  {clients?.map((client) => (
                    <TableRow
                      key={client.url}
                      className="hover:bg-muted/50 cursor-pointer"
                      onClick={(e) => handleViewClient(e, client)}
                    >
                      <TableCell className="font-medium">
                        {client.client}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {client.url}
                      </TableCell>
                      <TableCell>{client.readOnly ? 'Yes' : 'No'}</TableCell>
                      <TableCell>status</TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu
                          open={openDropdown === client.url}
                          onOpenChange={(open) =>
                            setOpenDropdown(open ? client.url : null)
                          }
                        >
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              className="h-8 w-8 p-0"
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                              }}
                            >
                              <span className="sr-only">Actions</span>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuItem
                              onClick={(e) => {
                                handleViewClient(e, client);
                              }}
                            >
                              <Eye className="mr-2 h-4 w-4" />
                              View Details
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEditClient(client);
                              }}
                            >
                              <Pencil className="mr-2 h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                // handleTestClient(client);
                              }}
                              disabled={testingClient === client.url}
                            >
                              <TestTube className="mr-2 h-4 w-4" />
                              {testingClient === client.url
                                ? 'Testing...'
                                : 'Test Connection'}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteClient(client);
                              }}
                            >
                              <Trash className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="mb-4 text-lg">
              No download clients configured. Add a client
            </p>
          )}
          {/* Form for adding/editing downloaders */}
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
              <div className="flex flex-wrap gap-2">
                <h2 className="text-xl font-bold">Download Client Options</h2>
                <fieldset className="form-fieldset w-full gap-6 rounded-md">
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
                        <field.TextField
                          label="Link Category"
                          required={false}
                        />
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
                      {(field) => (
                        <field.SwitchField label="Use Client Torrents" />
                      )}
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
        </div>

        {/* sheets for viewing/editing clients */}
        <ClientViewSheet
          open={viewSheetOpen}
          onOpenChange={handleViewSheetOpenChange}
          client={selectedClient}
          onEdit={handleEditClient}
        />
        <ClientEditSheet
          open={editSheetOpen}
          onOpenChange={handleEditSheetOpenChange}
          client={selectedClient}
          mode={editMode}
        />
      </Page>
    );
  },
});

export const Route = createFileRoute('/settings/downloaders')({
  component: DownloadersFields,
});
