import { cn } from '@/lib/utils';
import { FC } from 'react';

type TIndicatorProps = {
  status: 'ok' | 'error' | 'warning' | 'unknown';
};

export const StatusIndicator: FC<TIndicatorProps> = ({ status }) => {
  const colorMap = {
    ok: 'bg-green-500 dark:bg-green-600',
    error: 'bg-red-500 dark:bg-red-600',
    warning: 'bg-yellow-500',
    unknown: 'bg-slate-300 dark:bg-slate-700',
  };

  return (
    <div
      className={cn('relative', {
        'before:absolute before:inset-[-0px] before:animate-pulse before:rounded-full':
          status !== 'unknown',
        'before:shadow-glow before:text-green-200 dark:before:text-green-700/60':
          status === 'ok',
        'before:shadow-glow before:text-red-200 dark:before:text-red-700/70':
          status === 'error',
        'before:shadow-glow before:text-yellow-200 dark:before:text-yellow-700/70':
          status === 'warning',
      })}
    >
      <div className={cn(`relative h-4 w-4 rounded-full ${colorMap[status]}`)}>
        <span className="sr-only">Status is {status}</span>
      </div>
    </div>
  );
};
