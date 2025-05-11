import { createFileRoute } from '@tanstack/react-router';
import { HealthCheck } from '@/pages/Home/Home';

export const Route = createFileRoute('/')({
  component: HealthCheck,
});