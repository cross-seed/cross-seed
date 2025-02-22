import { FC } from 'react';
import { cn } from '@/lib/utils';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import './Form.css';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { FieldInfo } from './FieldInfo';
import { ArrayInputField } from './ArrayInputField';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Action,
  LinkType,
  MatchMode,
} from '@/features/ConfigForm/types/Form.types';
import { baseValidationSchema } from './types/Form.types';
import { Button } from '@/components/ui/button';

type FormProps = {
  className?: string;
};

type Config = z.infer<typeof baseValidationSchema>;

export const ConfigForm: FC<FormProps> = ({ className }) => {
  const form = useForm<Config>({
    defaultValues: {
      delay: 30,
      torznab: [''],
      useClientTorrents: false,
      dataDirs: [],
      matchMode: 'safe' as MatchMode,
      skipRecheck: true,
      autoResumeMaxDownload: 52428800,
      linkCategory: null,
      linkDir: null,
      linkDirs: [''],
      linkType: 'hardlink' as LinkType,
      flatLinking: false,
      maxDataDepth: 2,
      torrentDir: null,
      outputDir: '',
      injectDir: '',
      includeSingleEpisodes: false,
      includeNonVideos: false,
      fuzzySizeThreshold: 1,
      seasonFromEpisodes: null,
      excludeOlder: null,
      excludeRecentSearch: null,
      action: 'inject' as Action,
      qbittorrentUrl: null,
      rtorrentRpcUrl: null,
      transmissionRpcUrl: null,
      delugeRpcUrl: null,
      duplicateCategories: false,
      notificationWebhookUrls: [''],
      notificationWebhookUrl: null,
      port: null,
      host: null,
      rssCadence: null,
      searchCadence: null,
      snatchTimeout: null,
      searchTimeout: null,
      searchLimit: null,
      verbose: false,
      torrents: [''],
      blockList: [''],
      apiKey: null,
      radarr: [''],
      sonarr: [''],
    },
    onSubmit: async ({ value }) => {
      console.log('submitting form', value);
    },
    validators: {
      onChange: baseValidationSchema,
    },
  });

  const isFieldRequired = (fieldName: string) => {
    const schemaField = baseValidationSchema.shape[fieldName as keyof Config];
    return !schemaField.isOptional() && !schemaField.isNullable();
  };

  return (
    <div className={cn('mb-5', className)}>
      <h2 className="mb-6 text-2xl font-semibold dark:text-slate-100">
        Edit Config
      </h2>
      <form
        className="form flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
      >
        {/* form fields */}
        <div className="flex flex-wrap gap-6 dark:text-slate-100">
          <fieldset className="form-fieldset w-full gap-6 rounded-md">
            <legend>Directories and Paths</legend>
            <div className="">
              <form.Field name="dataDirs">
                {(field) => (
                  <ArrayInputField
                    field={field}
                    label="Data directories"
                    required={isFieldRequired(field.name)}
                  />
                )}
              </form.Field>
            </div>
            <form.Field name="flatLinking">
              {(field) => {
                return (
                  <div className="form-field__switch flex flex-col items-start gap-5">
                    <Label htmlFor={field.name} className="mr-3">
                      Flat linking
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Switch
                      id={field.name}
                      className="data-[state='checked']:bg-accent focus-visible:ring-accent"
                      checked={field.state.value ?? false}
                      onCheckedChange={field.handleChange}
                    />
                  </div>
                );
              }}
            </form.Field>
            <div className="">
              <form.Field name="linkType">
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Link Type
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Select
                      name={field.name}
                      defaultValue={field.state.value}
                      onValueChange={(e) => field.handleChange(e as LinkType)}
                    >
                      <SelectTrigger className="focus:ring-accent">
                        <SelectValue placeholder="Select a link type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hardlink">
                          hardlink
                          <span className="pl-1 text-slate-400">
                            (recommended)
                          </span>
                        </SelectItem>
                        <SelectItem value="symlink">symlink</SelectItem>
                      </SelectContent>
                    </Select>
                    <FieldInfo field={field} />
                  </div>
                )}
              </form.Field>
            </div>
            <div className="">
              <form.Field name="linkDirs">
                {(field) => (
                  <ArrayInputField
                    field={field}
                    label="Link directories"
                    required={isFieldRequired(field.name)}
                  />
                )}
              </form.Field>
            </div>
          </fieldset>
          <fieldset className="form-fieldset w-full gap-6 rounded-md">
            <legend>Connecting to Other Apps</legend>
            <div className="">
              <form.Field name="torznab">
                {(field) => (
                  <ArrayInputField
                    field={field}
                    label="Torznab URL(s)"
                    inputType="url"
                    required={isFieldRequired(field.name)}
                  />
                )}
              </form.Field>
            </div>
            <div className="">
              <form.Field name="notificationWebhookUrl">
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Notification Webhook URL
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="url"
                      className="form-input focus-visible:ring-accent"
                      name={field.name}
                      id={field.name}
                      value={field.state.value ?? ''}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldInfo field={field} />
                  </div>
                )}
              </form.Field>
            </div>
            <div className="">
              <form.Field name="sonarr">
                {(field) => (
                  <ArrayInputField
                    field={field}
                    label="Sonarr"
                    inputType="url"
                    required={isFieldRequired(field.name)}
                  />
                )}
              </form.Field>
            </div>
            <div>
              <form.Field name="radarr">
                {(field) => (
                  <ArrayInputField
                    field={field}
                    label="Radarr"
                    inputType="url"
                    required={isFieldRequired(field.name)}
                  />
                )}
              </form.Field>
            </div>
          </fieldset>
          <fieldset className="form-fieldset w-full gap-6 rounded-md">
            <legend>Connect to Cross Seed</legend>
            <div>
              <form.Field name="host">
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Host
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="text"
                      className="form-input focus-visible:ring-accent"
                      name={field.name}
                      id={field.name}
                      value={field.state.value ?? ''}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldInfo field={field} />
                  </div>
                )}
              </form.Field>
            </div>
            <div className="">
              <form.Field name="port">
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Port
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="number"
                      className="form-input focus-visible:ring-accent"
                      name={field.name}
                      id={field.name}
                      value={field.state.value ?? ''}
                      onChange={(e) =>
                        field.handleChange(Number(e.target.value))
                      }
                    />
                    <FieldInfo field={field} />
                  </div>
                )}
              </form.Field>
            </div>
            <div className="">
              <form.Field name="apiKey">
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      API Key (<code>apiKey</code>)
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="text"
                      className="form-input focus-visible:ring-accent"
                      name={field.name}
                      id={field.name}
                      value={field.state.value ?? ''}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldInfo field={field} />
                  </div>
                )}
              </form.Field>
            </div>
          </fieldset>
          <fieldset className="form-fieldset w-full gap-6 rounded-md">
            <legend>Downloading</legend>
            <p className="col-span-2 text-sm text-slate-400">
              Choose one client application to use for downloading and add its
              details here.
            </p>
            <div>
              <form.Field name="rtorrentRpcUrl">
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      rTorrent RPC URL
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="url"
                      className="form-input focus-visible:ring-accent"
                      name={field.name}
                      id={field.name}
                      placeholder="http://username:password@localhost:1234/RPC2"
                      value={field.state.value ?? ''}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldInfo field={field} />
                  </div>
                )}
              </form.Field>
            </div>
            <div>
              <form.Field name="qbittorrentUrl">
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      qBittorrent URL
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="url"
                      className="form-input focus-visible:ring-accent"
                      name={field.name}
                      id={field.name}
                      placeholder="http://username:password@localhost:8080"
                      value={field.state.value ?? ''}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldInfo field={field} />
                  </div>
                )}
              </form.Field>
            </div>
            <div>
              <form.Field name="transmissionRpcUrl">
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Transmission RPC URL
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="url"
                      className="form-input focus-visible:ring-accent"
                      name={field.name}
                      id={field.name}
                      placeholder="http://username:password@localhost:9091/transmission/rpc"
                      value={field.state.value ?? ''}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldInfo field={field} />
                  </div>
                )}
              </form.Field>
            </div>
            <div>
              <form.Field name="delugeRpcUrl">
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Deluge RPC URL
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="url"
                      className="form-input focus-visible:ring-accent"
                      name={field.name}
                      id={field.name}
                      placeholder="http://:password@localhost:8112/json"
                      value={field.state.value ?? ''}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldInfo field={field} />
                  </div>
                )}
              </form.Field>
            </div>
            <Separator className="col-span-2 my-5" />
            <div className="">
              <form.Field name="action">
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Action
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Select
                      name={field.name}
                      defaultValue={field.state.value}
                      onValueChange={(e) => field.handleChange(e as Action)}
                    >
                      <SelectTrigger className="focus:ring-accent">
                        <SelectValue placeholder="Select an action" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="inject">
                          Inject
                          <span className="pl-1 text-slate-400">
                            (recommended)
                          </span>
                        </SelectItem>
                        <SelectItem value="save">Save</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </form.Field>
            </div>
            <div className="">
              <form.Field name="linkCategory">
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Link Category
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="text"
                      className="form-input focus-visible:ring-accent"
                      name={field.name}
                      id={field.name}
                      value={field.state.value ?? ''}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldInfo field={field} />
                  </div>
                )}
              </form.Field>
            </div>
            <div className="">
              <form.Field name="torrentDir">
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Torrent Directory
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="text"
                      className="form-input focus-visible:ring-accent"
                      name={field.name}
                      id={field.name}
                      value={field.state.value ?? ''}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldInfo field={field} />
                  </div>
                )}
              </form.Field>
            </div>
            <div className="">
              <form.Field name="outputDir">
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Output Directory
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="text"
                      className="form-input focus-visible:ring-accent"
                      name={field.name}
                      id={field.name}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldInfo field={field} />
                  </div>
                )}
              </form.Field>
            </div>
            <div className="form-field-switches col-span-2">
              <form.Field name="skipRecheck">
                {(field) => {
                  return (
                    <div className="form-field__switch flex items-center">
                      <Label htmlFor={field.name} className="mr-3">
                        Skip Recheck
                        {isFieldRequired(field.name) && (
                          <span className="pl-1 text-red-500">*</span>
                        )}
                      </Label>
                      <Switch
                        id={field.name}
                        className="data-[state='checked']:bg-accent focus-visible:ring-accent"
                        checked={field.state.value}
                        onCheckedChange={field.handleChange}
                      />
                    </div>
                  );
                }}
              </form.Field>
              <form.Field name="useClientTorrents">
                {(field) => {
                  return (
                    <div className="form-field__switch flex items-center">
                      <Label htmlFor={field.name} className="mr-3">
                        Use Client Torrents
                        {isFieldRequired(field.name) && (
                          <span className="pl-1 text-red-500">*</span>
                        )}
                      </Label>
                      <Switch
                        id={field.name}
                        className="data-[state='checked']:bg-accent focus-visible:ring-accent"
                        checked={field.state.value}
                        onCheckedChange={field.handleChange}
                      />
                    </div>
                  );
                }}
              </form.Field>
              <form.Field name="duplicateCategories">
                {(field) => {
                  return (
                    <div className="form-field__switch flex items-center">
                      <Label htmlFor={field.name} className="mr-3">
                        duplicateCategories
                      </Label>
                      <Switch
                        id={field.name}
                        className="data-[state='checked']:bg-accent focus-visible:ring-accent"
                        checked={field.state.value}
                        onCheckedChange={field.handleChange}
                      />
                    </div>
                  );
                }}
              </form.Field>
            </div>
          </fieldset>
          <fieldset className="form-fieldset w-full gap-6 rounded-md">
            <legend>Searching and RSS</legend>
            <div className="">
              <form.Field name="delay">
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Delay
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="number"
                      className="form-input focus-visible:ring-accent"
                      name={field.name}
                      id={field.name}
                      placeholder="30"
                      value={field.state.value}
                      onChange={(e) =>
                        field.handleChange(Number(e.target.value))
                      }
                    />
                    <FieldInfo field={field} />
                  </div>
                )}
              </form.Field>
            </div>
            <div className="">
              <form.Field name="matchMode">
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Match Mode
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Select
                      name={field.name}
                      defaultValue={field.state.value}
                      onValueChange={(e) => field.handleChange(e as MatchMode)}
                    >
                      <SelectTrigger className="focus:ring-accent">
                        <SelectValue placeholder="Select a link type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="strict">
                          Strict
                          {/* <span className="pl-1 text-slate-400">
                            (recommended)
                          </span> */}
                        </SelectItem>
                        <SelectItem value="flexible">Risky</SelectItem>
                        <SelectItem value="partial">Partial</SelectItem>
                      </SelectContent>
                    </Select>
                    <FieldInfo field={field} />
                  </div>
                )}
              </form.Field>
            </div>
            <div className="">
              <form.Field name="rssCadence">
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      RSS Cadence
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="text"
                      className="form-input focus-visible:ring-accent"
                      name={field.name}
                      id={field.name}
                      placeholder="15 minutes"
                      value={field.state.value ?? ''}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldInfo field={field} />
                  </div>
                )}
              </form.Field>
            </div>
            <div className="">
              <form.Field name="searchCadence">
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Search Cadence
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="text"
                      className="form-input focus-visible:ring-accent"
                      name={field.name}
                      id={field.name}
                      placeholder="1 day"
                      value={field.state.value ?? ''}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldInfo field={field} />
                  </div>
                )}
              </form.Field>
            </div>
            <div className="">
              <form.Field name="snatchTimeout">
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Snatch Timeout
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="text"
                      className="form-input focus-visible:ring-accent"
                      name={field.name}
                      id={field.name}
                      value={field.state.value ?? ''}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldInfo field={field} />
                  </div>
                )}
              </form.Field>
            </div>
            <div className="">
              <form.Field name="searchTimeout">
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Search Timeout
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="text"
                      className="form-input focus-visible:ring-accent"
                      name={field.name}
                      id={field.name}
                      value={field.state.value ?? ''}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldInfo field={field} />
                  </div>
                )}
              </form.Field>
            </div>
            <div className="">
              <form.Field name="searchLimit">
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Search Limit
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="number"
                      className="form-input focus-visible:ring-accent"
                      name={field.name}
                      id={field.name}
                      value={field.state.value ?? ''}
                      onChange={(e) =>
                        field.handleChange(Number(e.target.value))
                      }
                    />
                    <FieldInfo field={field} />
                  </div>
                )}
              </form.Field>
            </div>
            <div className="">
              <form.Field name="excludeOlder">
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Exclude Older
                      {isFieldRequired(field.name) && (
                        <span className="pl-1 text-red-500">*</span>
                      )}
                    </Label>
                    <Input
                      type="text"
                      className="form-input focus-visible:ring-accent"
                      name={field.name}
                      id={field.name}
                      placeholder="2 weeks"
                      value={field.state.value ?? ''}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldInfo field={field} />
                  </div>
                )}
              </form.Field>
            </div>
            <div className="">
              <form.Field name="excludeRecentSearch">
                {(field) => (
                  <div className="space-y-3">
                    <Label htmlFor={field.name} className="block w-full">
                      Exclude Recent Search
                    </Label>
                    <Input
                      type="text"
                      className="form-input focus-visible:ring-accent"
                      name={field.name}
                      id={field.name}
                      placeholder="3 days"
                      value={field.state.value ?? ''}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldInfo field={field} />
                  </div>
                )}
              </form.Field>
            </div>
          </fieldset>
          <fieldset className="form-fieldset w-full gap-6 rounded-md">
            <legend>Misc. Settings</legend>
            <form.Field name="includeNonVideos">
              {(field) => {
                return (
                  <div className="form-field__switch flex items-center">
                    <Label htmlFor={field.name} className="mr-3">
                      includeNonVideos
                    </Label>
                    <Switch
                      id={field.name}
                      className="data-[state='checked']:bg-accent focus-visible:ring-accent"
                      checked={field.state.value}
                      onCheckedChange={field.handleChange}
                    />
                  </div>
                );
              }}
            </form.Field>
            <form.Field name="includeSingleEpisodes">
              {(field) => {
                return (
                  <div className="form-field__switch flex items-center">
                    <Label htmlFor={field.name} className="mr-3">
                      includeSingleEpisodes
                    </Label>
                    <Switch
                      id={field.name}
                      className="data-[state='checked']:bg-accent focus-visible:ring-accent"
                      checked={field.state.value}
                      onCheckedChange={field.handleChange}
                    />
                  </div>
                );
              }}
            </form.Field>
            <div className="">
              <form.Field name="blockList">
                {(field) => (
                  <ArrayInputField
                    field={field}
                    label="Block"
                    buttonLabel="Block"
                    required={isFieldRequired(field.name)}
                  />
                )}
              </form.Field>
            </div>
          </fieldset>
        </div>

        {/* The submit button */}
        <form.Subscribe
          selector={(state) => [
            state.canSubmit,
            state.isSubmitting,
            state.errors,
          ]}
        >
          {([canSubmit, isSubmitting, errors]) => (
            // console.log('form state', { canSubmit, errors, isValid });
            // return (
            <div className="sticky right-0 bottom-0 left-0 -mx-4 border-t border-solid border-slate-200 bg-white p-6 dark:bg-slate-900">
              <Button
                type="submit"
                className="bg-accent dark:bg-accent-800 dark:text-accent-50 w-full rounded-md px-4 py-4 text-white disabled:bg-slate-300 disabled:opacity-60"
                disabled={!canSubmit}
              >
                {isSubmitting ? 'Saving...' : 'Save'}
              </Button>
              {JSON.stringify(errors)}
            </div>
            // );
          )}
        </form.Subscribe>
      </form>
    </div>
  );
};

/**
 * List of enhancements/todos
 *
 * TODO: add hover card to explain fields
 * TODO: collapse/accordion the "edit config" section so it's not visible immediately
 */
