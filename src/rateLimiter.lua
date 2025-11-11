-- KEYS[1] = bucket key
-- ARGV = capacity, refill_rate_per_sec, now_millis, cost
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local ttl_seconds = tonumber(ARGV[5])

local data = redis.call('HMGET', KEYS[1], 'tokens', 'timestamp')
local tokens = tonumber(data[1])
local last_ts = tonumber(data[2])

if tokens == nil then
  tokens = capacity
  last_ts = now_ms
end

-- refill based on elapsed time
local delta_ms = math.max(0, now_ms - last_ts)
local refill = (delta_ms / 1000.0) * refill_rate
tokens = math.min(capacity, tokens + refill)

local allowed = 0
local remaining = tokens
local reset_ms = now_ms

if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
  remaining = tokens
else
  allowed = 0
  remaining = tokens
  local needed = cost - tokens
  local seconds_until = needed / refill_rate
  reset_ms = now_ms + math.ceil(seconds_until * 1000)
end

redis.call('HMSET', KEYS[1], 'tokens', tokens, 'timestamp', now_ms)
redis.call('EXPIRE', KEYS[1], ttl_seconds)

return { allowed, remaining, reset_ms }


