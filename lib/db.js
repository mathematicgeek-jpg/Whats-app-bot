/**
 * Serverless PostgreSQL connection module.
 * Uses @neondatabase/serverless for HTTP-based queries (zero TCP overhead),
 * falls back to standard pg.Pool for local development.
 */

import { logger } from './logger.js';

let _pool = null;
let _isNeon = false;
let _bootstrapped = false;

/**
 * Get or create the database connection pool.
 */
async function getPool() {
  if (_pool) return _pool;

  const dbUrl = (process.env.DATABASE_URL || 'postgresql://postgres:secretpassword@localhost:5432/mathgeek_db').trim();

  // Detect if using Neon (serverless Postgres)
  if (dbUrl.includes('neon.tech') || dbUrl.includes('neon.') || process.env.USE_NEON === 'true') {
    try {
      const { neon } = await import('@neondatabase/serverless');
      _pool = neon(dbUrl);
      _isNeon = true;
      logger.info('Database: Using Neon serverless driver (HTTP)');
      return _pool;
    } catch (err) {
      logger.warn('Neon driver not available, falling back to pg', { error: err.message });
    }
  }

  // Fallback: standard pg.Pool (local development)
  const pg = await import('pg');
  const Pool = pg.default?.Pool || pg.Pool;
  _pool = new Pool({
    connectionString: dbUrl,
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000
  });
  _pool.on('error', (err) => {
    logger.error('Unexpected error on idle database client', { error: err.message });
  });
  _isNeon = false;
  logger.info('Database: Using standard pg.Pool');
  return _pool;
}

/**
 * Execute a SQL query.
 * @param {string} sql - SQL query string with $1, $2 placeholders
 * @param {Array} params - Query parameters
 * @returns {object} { rows: Array, rowCount: number }
 */
export async function query(sql, params = []) {
  try {
    const pool = await getPool();

    if (_isNeon) {
      // Neon tagged template function — call with sql and params
      const rows = await pool(sql, params);
      return { rows, rowCount: rows.length };
    }

    // Standard pg.Pool
    const result = await pool.query(sql, params);
    return { rows: result.rows, rowCount: result.rowCount };
  } catch (err) {
    let hostname = 'unknown';
    try {
      const dbUrl = (process.env.DATABASE_URL || '').trim();
      if (dbUrl) {
        const cleanUrl = dbUrl.includes('://') ? dbUrl : `postgres://${dbUrl}`;
        const parsedUrl = new URL(cleanUrl);
        hostname = parsedUrl.hostname;
      }
    } catch (urlErr) {
      hostname = 'invalid-url-format';
    }
    throw new Error(`${err.message} (Database host: ${hostname})`);
  }
}

/**
 * Bootstrap database schema — creates all tables if they don't exist.
 * Called lazily on first invocation and cached via _bootstrapped flag.
 */
export async function bootstrapSchema() {
  if (_bootstrapped) return;

  try {
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(50) PRIMARY KEY,
        phone_number VARCHAR(30) UNIQUE NOT NULL,
        name VARCHAR(100),
        grade_segment VARCHAR(50),
        city VARCHAR(100),
        parent_phone VARCHAR(30),
        lead_stage VARCHAR(50) DEFAULT 'New',
        lead_score INTEGER DEFAULT 0,
        acquisition_source VARCHAR(100) DEFAULT 'organic',
        level INTEGER DEFAULT 1,
        xp INTEGER DEFAULT 0,
        streak INTEGER DEFAULT 0,
        rank VARCHAR(30) DEFAULT 'Bronze',
        badges TEXT DEFAULT '[]',
        energy INTEGER DEFAULT 5,
        last_active VARCHAR(50),
        derived_attributes TEXT DEFAULT '{}',
        created_at VARCHAR(50) NOT NULL,
        updated_at VARCHAR(50) NOT NULL
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR(50) PRIMARY KEY,
        user_phone VARCHAR(30) UNIQUE NOT NULL,
        current_workflow_id VARCHAR(50),
        current_node_id VARCHAR(50),
        game_state TEXT,
        variables TEXT,
        created_at VARCHAR(50) NOT NULL,
        updated_at VARCHAR(50) NOT NULL
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS behavioral_logs (
        id SERIAL PRIMARY KEY,
        user_phone VARCHAR(30) NOT NULL,
        event_type VARCHAR(50) NOT NULL,
        title VARCHAR(150) NOT NULL,
        description TEXT,
        payload TEXT,
        created_at VARCHAR(50) NOT NULL
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS performance_data (
        id VARCHAR(50) PRIMARY KEY,
        user_phone VARCHAR(30) NOT NULL,
        level INTEGER NOT NULL,
        concept_tag VARCHAR(50) NOT NULL,
        is_correct INTEGER NOT NULL,
        response_time_ms INTEGER NOT NULL,
        attempts INTEGER NOT NULL,
        created_at VARCHAR(50) NOT NULL
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS user_tags (
        user_phone VARCHAR(30) NOT NULL,
        tag VARCHAR(50) NOT NULL,
        assigned_at VARCHAR(50) NOT NULL,
        PRIMARY KEY (user_phone, tag)
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS journeys (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        definition TEXT NOT NULL,
        is_active BOOLEAN DEFAULT false,
        created_at VARCHAR(50) NOT NULL,
        updated_at VARCHAR(50) NOT NULL
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS segments (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        rules TEXT NOT NULL,
        created_at VARCHAR(50) NOT NULL,
        updated_at VARCHAR(50) NOT NULL
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS game_configs (
        id VARCHAR(50) PRIMARY KEY,
        level INTEGER UNIQUE NOT NULL,
        type VARCHAR(50) NOT NULL,
        time_limit INTEGER NOT NULL,
        reward INTEGER NOT NULL,
        created_at VARCHAR(50) NOT NULL,
        updated_at VARCHAR(50) NOT NULL
      )
    `);

    _bootstrapped = true;
    logger.info('Database schema bootstrapped successfully');
  } catch (err) {
    logger.error('Failed to bootstrap database schema', { error: err.message });
    throw err;
  }
}
