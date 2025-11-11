const express = require('express');

const demoRouter = express.Router();

demoRouter.get('/hello', (req, res) => {
  res.json({ message: 'hello world', user: req.rateLimitIdentity, tier: req.rateLimitTier });
});

demoRouter.get('/heavy', (req, res) => {
  // Simulate heavier endpoint to demo route-specific policies
  setTimeout(() => {
    res.json({ message: 'heavy work done' });
  }, 200);
});

module.exports = { demoRouter };


