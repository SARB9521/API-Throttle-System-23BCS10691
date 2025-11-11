## API Throttle – Distributed API Rate Limiting System


```
A lightweight and scalable rate-limiting system designed to control API usage across distributed services. It ensures fair access, prevents abuse, and maintains high system performance.
```

## Features
```
Distributed rate limiting (Redis-based)

Token bucket / sliding window algorithm

High-speed request handling

Easy integration with microservices

Configurable rate limits
```

##Tech Stack
```
Node.js

Express.js

Redis
```


## 📁 Project Structure

```
API_Throttle
├── client
│   ├── burst-test.js
│   ├── sustained-test.js
│   ├── multi-instance-test.js
│   ├── package.json
│   └── utils
│       └── request.js
└── server
    ├── package.json
    └── src
        ├── index.js
        ├── metrics.js
        ├── mongo.js
        ├── rateLimiter.js
        ├── rateLimiter.lua
        ├── redis.js
        └── routes
            ├── admin.js
            └─
