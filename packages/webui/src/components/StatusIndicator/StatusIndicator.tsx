import { cn } from '@/lib/utils';
import { FC } from 'react';

type TIndicatorProps = {
  status: 'ok' | 'error' | 'warning' | 'unknown';
};

export const StatusIndicator: FC<TIndicatorProps> = ({ status }) => {
  // Using custom colors for status since they have specific meaning
  const colorMap = {
    ok: 'bg-emerald-500',
    error: 'bg-destructive',
    warning: 'bg-amber-500',
    unknown: 'bg-muted',
  };

  return (
    <div
      className={cn('relative', {
        'before:absolute before:inset-[-0px] before:animate-pulse before:rounded-full':
          status !== 'unknown',
        'before:shadow-glow before:text-emerald-200':
          status === 'ok',
        'before:shadow-glow before:text-destructive/20':
          status === 'error',
        'before:shadow-glow before:text-amber-200':
          status === 'warning',
      })}
    >
      <div className={cn(`relative h-4 w-4 rounded-full ${colorMap[status]}`)}>
        <span className="sr-only">Status is {status}</span>
      </div>
    </div>
  );
};
