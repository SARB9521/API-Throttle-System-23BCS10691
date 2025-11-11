const { MongoClient } = require('mongodb');

async function createMongo() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
  const dbName = process.env.MONGODB_DB || 'api_throttle';
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
  await client.connect();
  const db = client.db(dbName);
  const audit = db.collection('throttle_audit');
  await audit.createIndex({ ts: -1 });
  await audit.createIndex({ userId: 1, route: 1, ts: -1 });
  return { client, db, audit };
}

module.exports = { createMongo };


