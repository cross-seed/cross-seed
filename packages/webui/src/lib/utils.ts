import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(
  bytes: number | null | undefined,
  options?: { binary?: boolean },
) {
  if (bytes === null || bytes === undefined) return 'Unknown';
  if (bytes === 0) return '0 B';
  const k = options?.binary ? 1024 : 1000;
  const sizes = options?.binary
    ? ['B', 'KiB', 'MiB', 'GiB', 'TiB']
    : ['B', 'kB', 'MB', 'GB', 'TB'];
  const exponent = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
  const coefficient = bytes / Math.pow(k, exponent);
  return `${parseFloat(coefficient.toFixed(2))} ${sizes[exponent]}`;
}
