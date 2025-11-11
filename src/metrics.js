const express = require('express');
const client = require('prom-client');

client.collectDefaultMetrics();

const requestsAllowed = new client.Counter({
  name: 'rate_limit_allows_total',
  help: 'Total allowed requests',
  labelNames: ['route', 'policy'],
});

const requestsDenied = new client.Counter({
  name: 'rate_limit_denies_total',
  help: 'Total denied requests',
  labelNames: ['route', 'policy'],
});

const requestLatency = new client.Histogram({
  name: 'request_latency_seconds',
  help: 'Request latency histogram',
  labelNames: ['route', 'method', 'status'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
});

function metricsMiddleware(req, res, next) {
  const end = requestLatency.startTimer({ route: req.path, method: req.method });
  res.on('finish', () => {
    end({ status: String(res.statusCode) });
  });
  next();
}

const metricsRouter = express.Router();
metricsRouter.get('/', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.send(await client.register.metrics());
});

module.exports = {
  metricsMiddleware,
  metricsRouter,
  requestsAllowed,
  requestsDenied,
  register: client.register,
};


