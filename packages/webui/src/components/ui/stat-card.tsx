import { cn } from '@/lib/utils';

interface StatCardProps {
  title: string;
  value: string | number;
  description?: string;
  className?: string;
  trend?: {
    value: number;
    label: string;
  };
}

export function StatCard({
  title,
  value,
  description,
  className,
  trend,
}: StatCardProps) {
  return (
    <div
      className={cn(
        'bg-card text-card-foreground rounded-lg border p-6 shadow-sm',
        className,
      )}
    >
      <div className="flex flex-row items-center justify-between space-y-0 pb-2">
        <h3 className="text-sm font-medium tracking-tight">{title}</h3>
      </div>
      <div className="flex items-center space-x-2">
        <div className="text-2xl font-bold">{value}</div>
        {trend && (
          <div className="text-muted-foreground text-xs">
            <span
              className={cn(
                'font-medium',
                trend.value > 0 ? 'text-green-600' : 'text-red-600',
              )}
            >
              {trend.value > 0 ? '+' : ''}
              {trend.value}
            </span>{' '}
            {trend.label}
          </div>
        )}
      </div>
      {description && (
        <p className="text-muted-foreground text-xs">{description}</p>
      )}
    </div>
  );
}
