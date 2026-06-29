import Fastify from 'fastify';
import dotenv from 'dotenv';
import { pgPool } from '@mathgeek/db';
import { logger } from '@mathgeek/utils';

dotenv.config();

const fastify = Fastify({ logger: false });
const PORT = process.env.PORT || 3007;

// Health Check
fastify.get('/health', async () => ({ status: 'healthy', service: 'config-service' }));

// --- JOURNEYS ENDPOINTS ---
fastify.get('/api/config/journeys', async () => {
  const res = await pgPool.query('SELECT * FROM journeys ORDER BY updated_at DESC');
  return res.rows.map(r => ({ ...r, definition: JSON.parse(r.definition) }));
});

fastify.get('/api/config/journeys/:id', async (request, reply) => {
  const res = await pgPool.query('SELECT * FROM journeys WHERE id = $1', [request.params.id]);
  if (res.rows.length === 0) return reply.code(404).send({ error: 'Journey not found' });
  const row = res.rows[0];
  return { ...row, definition: JSON.parse(row.definition) };
});

fastify.post('/api/config/journeys', async (request, reply) => {
  const { id, name, definition, is_active } = request.body || {};
  if (!id || !name || !definition) {
    return reply.code(400).send({ error: 'id, name, and definition are required' });
  }

  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    const now = new Date().toISOString();
    
    // Upsert journey
    await client.query(
      `INSERT INTO journeys (id, name, definition, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET 
         name = EXCLUDED.name,
         definition = EXCLUDED.definition,
         is_active = EXCLUDED.is_active,
         updated_at = EXCLUDED.updated_at`,
      [id, name, typeof definition === 'string' ? definition : JSON.stringify(definition), !!is_active, now, now]
    );

    // If setting active, deactivate other journeys
    if (is_active) {
      await client.query('UPDATE journeys SET is_active = false WHERE id != $1', [id]);
    }

    await client.query('COMMIT');
    logger.info(`Config: Upserted journey "${id}" (Active: ${!!is_active})`);
    return { success: true };
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(`Failed to upsert journey: ${err.message}`);
    return reply.code(500).send({ error: err.message });
  } finally {
    client.release();
  }
});

// --- SEGMENTS ENDPOINTS ---
fastify.get('/api/config/segments', async () => {
  const res = await pgPool.query('SELECT * FROM segments ORDER BY updated_at DESC');
  return res.rows.map(r => ({ ...r, rules: JSON.parse(r.rules) }));
});

fastify.post('/api/config/segments', async (request, reply) => {
  const { id, name, rules } = request.body || {};
  if (!id || !name || !rules) {
    return reply.code(400).send({ error: 'id, name, and rules are required' });
  }

  try {
    const now = new Date().toISOString();
    await pgPool.query(
      `INSERT INTO segments (id, name, rules, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         rules = EXCLUDED.rules,
         updated_at = EXCLUDED.updated_at`,
      [id, name, typeof rules === 'string' ? rules : JSON.stringify(rules), now, now]
    );
    logger.info(`Config: Upserted segment "${id}"`);
    return { success: true };
  } catch (err) {
    logger.error(`Failed to upsert segment: ${err.message}`);
    return reply.code(500).send({ error: err.message });
  }
});

// --- GAME CONFIGS ENDPOINTS ---
fastify.get('/api/config/games', async () => {
  const res = await pgPool.query('SELECT * FROM game_configs ORDER BY level ASC');
  return res.rows;
});

fastify.post('/api/config/games', async (request, reply) => {
  const { id, level, type, time_limit, reward } = request.body || {};
  if (!id || level === undefined || !type || time_limit === undefined || reward === undefined) {
    return reply.code(400).send({ error: 'id, level, type, time_limit, and reward are required' });
  }

  try {
    const now = new Date().toISOString();
    await pgPool.query(
      `INSERT INTO game_configs (id, level, type, time_limit, reward, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (level) DO UPDATE SET
         id = EXCLUDED.id,
         type = EXCLUDED.type,
         time_limit = EXCLUDED.time_limit,
         reward = EXCLUDED.reward,
         updated_at = EXCLUDED.updated_at`,
      [id, level, type, time_limit, reward, now, now]
    );
    logger.info(`Config: Upserted game config for level ${level}`);
    return { success: true };
  } catch (err) {
    logger.error(`Failed to upsert game config: ${err.message}`);
    return reply.code(500).send({ error: err.message });
  }
});

// --- TRIGGERS ENDPOINTS ---
fastify.get('/api/config/triggers', async () => {
  const res = await pgPool.query('SELECT * FROM triggers ORDER BY updated_at DESC');
  return res.rows.map(r => ({ ...r, actions: JSON.parse(r.actions) }));
});

fastify.post('/api/config/triggers', async (request, reply) => {
  const { id, name, event_type, actions } = request.body || {};
  if (!id || !name || !event_type || !actions) {
    return reply.code(400).send({ error: 'id, name, event_type, and actions are required' });
  }

  try {
    const now = new Date().toISOString();
    await pgPool.query(
      `INSERT INTO triggers (id, name, event_type, actions, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         event_type = EXCLUDED.event_type,
         actions = EXCLUDED.actions,
         updated_at = EXCLUDED.updated_at`,
      [id, name, event_type, typeof actions === 'string' ? actions : JSON.stringify(actions), now, now]
    );
    logger.info(`Config: Upserted trigger "${id}"`);
    return { success: true };
  } catch (err) {
    logger.error(`Failed to upsert trigger: ${err.message}`);
    return reply.code(500).send({ error: err.message });
  }
});

// --- TEMPLATES ENDPOINTS ---
fastify.get('/api/config/templates', async () => {
  const res = await pgPool.query('SELECT * FROM message_templates ORDER BY updated_at DESC');
  return res.rows;
});

fastify.post('/api/config/templates', async (request, reply) => {
  const { id, name, text, category } = request.body || {};
  if (!id || !name || !text || !category) {
    return reply.code(400).send({ error: 'id, name, text, and category are required' });
  }

  try {
    const now = new Date().toISOString();
    await pgPool.query(
      `INSERT INTO message_templates (id, name, text, category, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         text = EXCLUDED.text,
         category = EXCLUDED.category,
         updated_at = EXCLUDED.updated_at`,
      [id, name, text, category, now, now]
    );
    logger.info(`Config: Upserted template "${id}"`);
    return { success: true };
  } catch (err) {
    logger.error(`Failed to upsert template: ${err.message}`);
    return reply.code(500).send({ error: err.message });
  }
});

// Start Server
const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`🚀 Config Service running on http://localhost:${PORT}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
