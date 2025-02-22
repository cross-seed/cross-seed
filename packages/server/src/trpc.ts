import { initTRPC } from '@trpc/server';
import * as trpcExpress from '@trpc/server/adapters/express';
// import { createContext } from 'vm';

const createContext = ({
  req,
  res,
}: trpcExpress.CreateExpressContextOptions) => ({});
type Context = Awaited<ReturnType<typeof createContext>>;

export const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
// import { initTRPC } from '@trpc/server';

// const t = initTRPC.create();

// export const router = t.router;
// export const publicProcedure = t.procedure;
