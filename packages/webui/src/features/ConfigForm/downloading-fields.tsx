import { withForm } from '@/hooks/form';
import { Separator } from '@/components/ui/separator';
import { Action } from '../../../../shared/constants';

const DownloadingFields = withForm({
  // ...defaultValues,
  render: ({ form }) => {
    return (
      <fieldset className="form-fieldset w-full gap-6 rounded-md">
        <legend>Downloading</legend>
        <p className="col-span-2 text-sm text-slate-400">
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
                required={false}
              />
            )}
          </form.AppField>
        </div>
        <Separator className="col-span-2 my-5" />
        <div className="">
          <form.AppField name="action">
            {(field) => <field.SelectField label="Action" options={Action} />}
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
              <field.TextField label="Torrent Directory" required={false} />
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
              <field.TextField label="Output Directory" required={false} />
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
            {(field) => <field.SwitchField label="Duplicate Categories" />}
          </form.AppField>
        </div>
      </fieldset>
    );
  },
});

export default DownloadingFields;
