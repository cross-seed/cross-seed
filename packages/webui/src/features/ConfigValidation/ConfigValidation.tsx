import { FC, Fragment } from 'react';
import { useTRPC } from '@/lib/trpc';
import { StatusIndicator } from '@/components/StatusIndicator/StatusIndicator';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';

export const ConfigValidation: FC = () => {
  const trpc = useTRPC();
  const { data, isLoading, isError, error } = useQuery(
    trpc.config.validate.queryOptions(),
  );
  return (
    <div className="mb-6">
      <h2 className="mb-6 text-2xl font-semibold">Config Validation</h2>
      {isLoading && <div>Loading...</div>}
      {isError && <div>Error: {error.message}</div>}
      {data && (
        <div className="flex w-full gap-6">
          {Object.entries(data.validations).map(([section, content]) => (
            <ValidationEntry
              key={section}
              title={section}
              content={section === 'uarrls' ? content.arr : content}
              className="border-border w-1/3 rounded-lg border border-solid px-5 py-4"
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
  const titleMap = {
    paths: 'Paths',
    torznab: 'Torznab',
    uarrls: 'App Integrations',
  };
  const heading = titleMap[title as keyof typeof titleMap] ?? title;
  const entries = Object.entries(content[title] ?? content);
  return (
    <div className={cn('divide-muted mb-4 divide-y divide-solid', className)}>
      <h3 className="mb-4 text-lg font-medium">{heading}</h3>
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="flex min-w-40 items-center justify-between py-3"
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
