import ms from 'ms';

export function formatRelativeTime(timestamp: string | number): string {
  const date =
    typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp);
  const now = new Date();
  const diffInMs = now.getTime() - date.getTime();

  // More than 7 days, fall back to absolute date
  if (Math.abs(diffInMs) > ms('7d')) {
    return date.toLocaleDateString('en', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // Use ms to format the difference
  const formatted = ms(Math.ceil(diffInMs / 1000) * 1000, { long: true });
  const [number, unit] = formatted.split(' ');

  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  return rtf.format(-parseInt(number), unit as Intl.RelativeTimeFormatUnit);
}
