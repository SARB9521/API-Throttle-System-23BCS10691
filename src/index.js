const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const pino = require('pino');
const pinoHttp = require('pino-http');
const { createRedisClient } = require('./redis');
const { rateLimiterMiddleware, loadPolicies } = require('./rateLimiter');
const { createMongo } = require('./mongo');
const { metricsMiddleware, register, metricsRouter } = require('./metrics');
const { adminRouter } = require('./routes/admin');
const { demoRouter } = require('./routes/demo');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3000;

async function main() {
  const app = express();

  const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
  app.use(pinoHttp({ logger }));
  app.use(morgan('tiny'));
  app.use(helmet());
  app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
  app.use(express.json());

  // Correlation ID
  app.use((req, res, next) => {
    const existing = req.headers['x-correlation-id'];
    const id = existing && typeof existing === 'string' && existing.length > 0 ? existing : uuidv4();
    req.correlationId = id;
    res.setHeader('X-Correlation-Id', id);
    next();
  });

  const redis = await createRedisClient();
  const mongo = await createMongo();

  // Load initial policies into memory (from env and Redis)
  await loadPolicies(redis);

  // Metrics must be early to time middleware properly
  app.use(metricsMiddleware);

  // Rate limiter must be early to protect all routes by default
  app.use(rateLimiterMiddleware({ redis, mongo }));

  // Health
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Metrics
  app.use('/metrics', metricsRouter);

  // Demo/test routes
  app.use('/api', demoRouter);

  // Admin
  app.use('/admin', adminRouter({ redis }));

  app.use((err, req, res, next) => {
    req.log?.error({ err }, 'Unhandled error');
    res.status(500).json({ error: 'Internal Server Error' });
  });

  app.listen(PORT, () => {
    logger.info({ port: PORT }, 'Server listening');
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error starting server', err);
  process.exit(1);
});


