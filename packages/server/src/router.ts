import { promises as fs } from 'fs';
import { router, publicProcedure } from './trpc';
import path from 'path';
// import { z } from 'zod';

export const appRouter = router({
  healthcheck: publicProcedure.query(() => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }),

  /**
   * Config checking endpoints
   */
  config: router({
    get: publicProcedure.query(() => {
      return {};
    }),

    validate: publicProcedure.query(async () => {
      // validate config or get validation status
      try {
        const response = await fetch(
          'http://localhost:2468/api/config/validate',
          {
            headers: {
              Accept: 'application/json',
            },
          },
        );

        if (!response.ok) {
          throw new Error(`Failed to validate config: ${response.statusText}`);
        }

        return response.json();
      } catch (error) {
        throw new Error(`Failed to validate config: ${error}`);
      }
    }),
  }),

  logs: router({
    getVerbose: publicProcedure.query(async () => {
      // get verbose logs
      try {
        const logPath = path.join(
          process.cwd(),
          '../../cross-seed/logs/verbose.current.log',
        );
        const logData = await fs.readFile(logPath, 'utf-8');
        return logData;
      } catch (error) {
        throw new Error(`Failed to read verbose logs: ${error}`);
      }
    }),
  }),
});

export type AppRouter = typeof appRouter;
