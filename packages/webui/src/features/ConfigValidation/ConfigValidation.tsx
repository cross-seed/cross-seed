import { FC, Fragment } from 'react';
import { trpc } from '@/lib/trpc';
import { StatusIndicator } from '@/components/StatusIndicator/StatusIndicator';
import { cn } from '@/lib/utils';

export const ConfigValidation: FC = () => {
  const { data, isLoading, isError, error } = trpc.config.validate.useQuery();
  return (
    <div className="mb-6">
      <h2 className="mb-6 text-2xl font-semibold dark:text-slate-100">
        Config Validation
      </h2>
      {isLoading && <div>Loading...</div>}
      {isError && <div>Error: {error.message}</div>}
      {data && (
        <div className="flex w-full gap-6">
          {Object.entries(data.validations).map(([section, content]) => (
            <ValidationEntry
              key={section}
              title={section}
              content={section === 'uarrls' ? content.arr : content}
              className="w-1/3 rounded-lg border border-solid border-slate-200 px-5 py-4 dark:border-slate-700"
            />
          ))}
        </div>
      )}
    </div>
  );
};

const ValidationEntry = ({
  title,
  content,
  className,
}: {
  title: string;
  content: any;
  className?: string;
}) => {
  console.log(content[title] ?? content);

  const titleMap = {
    paths: 'Paths',
    torznab: 'Torznab',
    uarrls: 'App Integrations',
  };
  const heading = titleMap[title as keyof typeof titleMap] ?? title;
  const entries = Object.entries(content[title] ?? content);
  return (
    <div
      className={cn(
        'mb-4 divide-y divide-solid divide-slate-50 dark:divide-slate-800',
        className,
      )}
    >
      <h3 className="mb-4 text-lg font-medium dark:text-slate-100">
        {heading}
      </h3>
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="flex min-w-40 items-center justify-between py-3 dark:text-slate-100"
        >
          <span className="font-mono text-sm">{key}</span>
          {title === 'paths' && (
            <PathStatus status={value as TPathValidationResponse} />
          )}
          {title === 'torznab' && (
            <TorznabStatus status={value as TTorznabStatus} />
          )}
          {title === 'uarrls' && (
            <ArrAppStatus status={value as TArrAppStatusResponse} />
          )}
        </div>
      ))}
    </div>
  );
};

type TPathStatus = {
  valid: boolean;
  error?: string;
  path?: string;
};

type TPathValidationResponse = TPathStatus | TPathStatus[];

const PathStatus = ({ status }: { status: TPathValidationResponse }) => {
  return (
    <>
      {Array.isArray(status) ? (
        status.length > 0 ? (
          status.map((item) => (
            <Fragment key={item.path}>
              {JSON.stringify(item)}
              <span key={item.path}>{item.error}</span>
              <span className="ml-2">
                <StatusIndicator
                  status={!item.valid ? 'error' : item.valid ? 'ok' : 'unknown'}
                />
              </span>
            </Fragment>
          ))
        ) : (
          // Status is unknown because the array is empty
          <span className="ml-2">
            <StatusIndicator status="unknown" />
          </span>
        )
      ) : (
        <span className="ml-2">
          <StatusIndicator
            status={!status.valid ? 'error' : status.valid ? 'ok' : 'unknown'}
          />
        </span>
      )}
    </>
  );
};

type TTorznabStatus = {
  url: string;
  valid: boolean;
  error?: string;
};

type TTorznabStatusResponse = TTorznabStatus | TTorznabStatus[];

const TorznabStatus = ({ status }: { status: TTorznabStatusResponse }) => {
  return (
    <>
      {Array.isArray(status) ? (
        status.length > 0 ? (
          status.map((item) => (
            <Fragment key={item.url}>
              {/* <span key={item.url}>{item.error}</span> */}
              <span className="ml-2">
                <StatusIndicator
                  status={!item.valid ? 'error' : item.valid ? 'ok' : 'unknown'}
                />
              </span>
            </Fragment>
          ))
        ) : (
          // Status is unknown because the array is empty
          <span className="ml-2">
            <StatusIndicator status="unknown" />
          </span>
        )
      ) : (
        <span className="ml-2">
          <StatusIndicator
            status={!status.valid ? 'error' : status.valid ? 'ok' : 'unknown'}
          />
        </span>
      )}
    </>
  );
};

type TArrAppStatus = {
  url: string;
  valid: boolean;
  error?: string;
};

type TArrAppStatusResponse = TArrAppStatus | TArrAppStatus[];

const ArrAppStatus = ({ status }: { status: TArrAppStatusResponse }) => {
  return (
    <>
      {Array.isArray(status) ? (
        status.length > 0 ? (
          status.map((item) => (
            <Fragment key={item.url}>
              {/* <span key={item.url}>{item.error}</span> */}
              <span className="ml-2">
                <StatusIndicator
                  status={!item.valid ? 'error' : item.valid ? 'ok' : 'unknown'}
                />
              </span>
            </Fragment>
          ))
        ) : (
          // Status is unknown because the array is empty
          <span className="ml-2">
            <StatusIndicator status="unknown" />
          </span>
        )
      ) : (
        <span className="ml-2">
          <StatusIndicator
            status={!status.valid ? 'error' : status.valid ? 'ok' : 'unknown'}
          />
        </span>
      )}
    </>
  );
};
