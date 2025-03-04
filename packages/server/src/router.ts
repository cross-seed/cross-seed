import { promises as fs } from 'fs';
import { router, publicProcedure } from './trpc';
import path from 'path';

// Router for the server, must call the cross-seed API
const host = 'localhost'; // '192.168.1.234';
const port = '2468';

const url = `http://${host}:${port}`;

export const appRouter = router({
  healthcheck: publicProcedure.query(async () => {
    console.log('pinging cross-seed');
    try {
      const response = await fetch(`${url}/api/ping`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to ping cross-seed: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      return {
        status: 'fetch error',
        message: error,
        timestamp: new Date().toISOString(),
      };
    }
  }),

  /**
   * Config checking endpoints
   */
  config: router({
    get: publicProcedure.query(async () => {
      // get config file contents from cross-seed
      try {
        const response = await fetch(`${url}/api/config`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to read config file: ${response.statusText}`);
        }

        return await response.json();
      } catch (error) {
        throw new Error(`Failed to read config file: ${error}`);
      }
    }),

    // save config file contents to cross-seed
    save: publicProcedure.mutation(async ({ input }) => {
      try {
        const response = await fetch(`${url}/api/config`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(input),
        });

        if (!response.ok) {
          throw new Error(`Failed to save config file: ${response.statusText}`);
        }

        return await response.json();
      } catch (error) {
        throw new Error(`Failed to save config file: ${error}`);
      }
    }),

    validate: publicProcedure.query(async () => {
      // validate config or get validation status
      try {
        const response = await fetch(`${url}/api/config/validate`, {
          headers: {
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to validate config: ${response.statusText}`);
        }

        return await response.json();
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
