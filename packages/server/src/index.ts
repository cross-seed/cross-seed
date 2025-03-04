import express from 'express';
import cors from 'cors';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from './router';

const app = express();
const port = Number(process.env.PORT) || 3000;

// const URL_SERVER = 'http://192.168.1.234:4000';
const URL_CLIENT = '*';

app.options('*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', `${URL_CLIENT}`);
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, DELETE, OPTIONS',
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, trpc-batch',
  );
  //   res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.status(204).end();
});

app.use(
  cors({
    origin: `${URL_CLIENT}`,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'Authorization', 'trpc-batch'],
  }),
);

app.use(
  '/api',
  createExpressMiddleware({
    router: appRouter,
    createContext: () => ({}),
  }),
);

app.use('*', (req, res) => {
  console.log('Unhandled request:', req.method, req.url);
  res.status(404).json({ error: 'Not found' });
});

Promise.all([app.listen(port, 'localhost'), app.listen(port, '0.0.0.0')]).then(
  () => {
    console.log(`Server listening on port ${port}`);
  },
);
// const server = app.listen(port, '0.0.0.0', () => {
//   console.log(`Server details:`, {
//     port,
//     address: server.address(),
//     timeStamp: new Date().toISOString(),
//   });
// });
