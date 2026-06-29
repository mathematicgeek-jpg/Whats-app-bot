import pg from 'pg';
import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// PostgreSQL Connection Pool
export const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:secretpassword@localhost:5432/mathgeek_db',
  max: 20, // Max pool clients
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});

// Redis Client
export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

pgPool.on('error', (err) => {
  console.error('Unexpected error on idle pg client:', err.message);
});

redis.on('error', (err) => {
  console.error('Redis client connection error:', err.message);
});
