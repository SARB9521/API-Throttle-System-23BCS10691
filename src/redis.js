const Redis = require('ioredis');

async function createRedisClient() {
  const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const redis = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
  });

  redis.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('Redis error', err);
  });

  await redis.connect();
  return redis;
}

module.exports = { createRedisClient };


