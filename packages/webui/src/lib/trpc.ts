import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '../../../src/trpc/routers/index';

export const trpc = createTRPCReact<AppRouter>();
