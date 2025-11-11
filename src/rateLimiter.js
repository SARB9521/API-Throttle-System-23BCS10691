const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { requestsAllowed, requestsDenied } = require('./metrics');

let luaSha = null;
let inMemoryPolicies = {
  global: {
    capacity: Number(process.env.RL_CAPACITY || 100),
    refillPerSec: Number(process.env.RL_REFILL_PER_SEC || 100 / 60),
    cost: 1,
    ttlSeconds: 120,
  },
  routes: {
    // example: '/api/heavy': { capacity: 20, refillPerSec: 10, cost: 1, ttlSeconds: 120 }
  },
  tiers: {
    // example: 'admin': { multiplier: 2 }
  },
  exemptions: {
    // userId -> true
  },
};

async function loadPolicies(redis) {
  try {
    const raw = await redis.get('rate_limit:policies');
    if (raw) {
      const parsed = JSON.parse(raw);
      inMemoryPolicies = { ...inMemoryPolicies, ...parsed };
    }
  } catch (e) {
    // ignore; keep defaults
  }
}

function getPolicyForRequest(req) {
  const route = req.route?.path || req.path;
  const routeOverride = inMemoryPolicies.routes[route];
  const base = routeOverride || inMemoryPolicies.global;

  const tier = req.rateLimitTier || 'standard';
  const tierCfg = inMemoryPolicies.tiers[tier] || { multiplier: 1 };
  const capacity = Math.max(1, Math.floor(base.capacity * (tierCfg.multiplier || 1)));
  const refillPerSec = base.refillPerSec * (tierCfg.multiplier || 1);

  return { capacity, refillPerSec, cost: base.cost || 1, ttlSeconds: base.ttlSeconds || 120, name: routeOverride ? `route:${route}` : 'global' };
}

function deriveIdentity(req) {
  // Priority: API key -> JWT sub -> IP
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.length > 0) {
    return { userId: `apiKey:${apiKey}`, tier: 'standard' };
  }
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.slice(7);
    try {
      const payload = jwt.decode(token) || {};
      if (payload.sub) {
        return { userId: `user:${payload.sub}`, tier: payload.tier || 'standard' };
      }
    } catch (_) {
      // fall through
    }
  }
  const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  return { userId: `ip:${ip}`, tier: 'anonymous' };
}

async function ensureLua(redis) {
  if (luaSha) return luaSha;
  const script = fs.readFileSync(path.join(__dirname, 'rateLimiter.lua'), 'utf8');
  luaSha = await redis.script('LOAD', script);
  return luaSha;
}

function setHeaders(res, policy, allowed, remaining, resetMs) {
  const limit = policy.capacity;
  const nowSec = Math.floor(Date.now() / 1000);
  const resetSec = Math.ceil(resetMs / 1000);
  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, Math.floor(remaining))));
  res.setHeader('X-RateLimit-Reset', String(resetSec));
  if (!allowed) {
    res.setHeader('Retry-After', String(Math.max(0, resetSec - nowSec)));
  }
}

function rateLimiterMiddleware({ redis, mongo }) {
  return async function rateLimiter(req, res, next) {
    const identity = deriveIdentity(req);
    req.rateLimitIdentity = identity.userId;
    req.rateLimitTier = identity.tier;

    if (inMemoryPolicies.exemptions[identity.userId]) return next();

    const policy = getPolicyForRequest(req);
    const key = `rl:{${req.path}}:{${identity.userId}}`;
    const nowMs = Date.now();

    try {
      const sha = await ensureLua(redis);
      const result = await redis.evalsha(
        sha,
        1,
        key,
        policy.capacity,
        policy.refillPerSec,
        nowMs,
        policy.cost || 1,
        policy.ttlSeconds || 120,
      );
      const allowed = result[0] === 1;
      const remaining = Number(result[1]);
      const resetMs = Number(result[2]);
      setHeaders(res, policy, allowed, remaining, resetMs);

      if (allowed) {
        requestsAllowed.inc({ route: req.path, policy: policy.name });
        return next();
      }

      requestsDenied.inc({ route: req.path, policy: policy.name });

      // Sampled audit: 10% by default
      const sampleRate = Number(process.env.AUDIT_SAMPLE_RATE || 0.1);
      if (mongo?.audit && Math.random() < sampleRate) {
        mongo.audit.insertOne({
          ts: new Date(),
          route: req.path,
          userId: identity.userId,
          tier: req.rateLimitTier,
          remaining,
          resetMs,
          correlationId: req.correlationId,
          headers: {
            limit: policy.capacity,
            remaining: Math.max(0, Math.floor(remaining)),
            reset: Math.ceil(resetMs / 1000),
          },
        }).catch(() => {});
      }

      return res.status(429).json({ error: 'Too Many Requests' });
    } catch (err) {
      // Resilience: if Redis is down, allow request but log
      req.log?.warn({ err }, 'Rate limiter degraded - allowing request');
      return next();
    }
  };
}

const policySchema = z.object({
  global: z.object({ capacity: z.number(), refillPerSec: z.number(), cost: z.number().optional(), ttlSeconds: z.number().optional() }).partial({ cost: true, ttlSeconds: true }).required(),
  routes: z.record(z.string(), z.object({ capacity: z.number(), refillPerSec: z.number(), cost: z.number().optional(), ttlSeconds: z.number().optional() })).optional(),
  tiers: z.record(z.string(), z.object({ multiplier: z.number() })).optional(),
  exemptions: z.record(z.string(), z.boolean()).optional(),
});

function policiesRouter({ redis }) {
  const express = require('express');
  const router = express.Router();
  router.get('/', async (req, res) => {
    res.json(inMemoryPolicies);
  });
  router.post('/', async (req, res) => {
    try {
      const body = policySchema.parse(req.body);
      // merge shallowly
      inMemoryPolicies = { ...inMemoryPolicies, ...body };
      await redis.set('rate_limit:policies', JSON.stringify(inMemoryPolicies));
      res.json({ ok: true, policies: inMemoryPolicies });
    } catch (e) {
      res.status(400).json({ error: 'invalid policies', details: e.message });
    }
  });
  return router;
}

module.exports = {
  rateLimiterMiddleware,
  loadPolicies,
  policiesRouter,
};


