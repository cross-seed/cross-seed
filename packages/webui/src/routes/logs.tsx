import { createFileRoute } from '@tanstack/react-router';
import { Logs } from '@/features/Logs/Logs';

export const Route = createFileRoute('/logs')({
  component: Logs,
});