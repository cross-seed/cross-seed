import { useTRPC } from '@/lib/trpc';
import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';

export const Route = createFileRoute('/search')({
  component: Search,
});

function Search() {
  const { data: authStatus } = useQuery(useTRPC().config.get.queryOptions());
  return <pre>{JSON.stringify(authStatus, null, 2)}</pre>;
}
