const express = require('express');
const { policiesRouter } = require('../rateLimiter');

function adminRouter({ redis }) {
  const router = express.Router();

  // Simple auth via admin API key
  router.use((req, res, next) => {
    const key = req.headers['x-admin-key'];
    if (!process.env.ADMIN_KEY) return res.status(403).json({ error: 'admin disabled' });
    if (key !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'unauthorized' });
    next();
  });

  router.use('/policies', policiesRouter({ redis }));

  return router;
}

module.exports = { adminRouter };


