import Fastify from 'fastify';
import dotenv from 'dotenv';
import { publishEvent } from '@mathgeek/event-bus';
import { createEvent } from '@mathgeek/event-schema';
import { pgPool, redis } from '@mathgeek/db';
import { logger } from '@mathgeek/utils';
import Redis from 'ioredis';
import fs from 'fs';

dotenv.config();

const fastify = Fastify({ logger: false });
const PORT = process.env.PORT || 3001;
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'MATH_GEEK_BOT_VERIFY_TOKEN';

// Setup database tables if they do not exist (Bootstrap DB on local dev)
async function bootstrapDatabase() {
  const client = await pgPool.connect();
  try {
    logger.info('Bootstrapping PostgreSQL schemas...');
    await client.query(`
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
        created_at VARCHAR(50) NOT NULL,
        updated_at VARCHAR(50) NOT NULL
      )
    `);

    await client.query(`
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

    await client.query(`
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

    await client.query(`
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

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_tags (
        user_phone VARCHAR(30) NOT NULL,
        tag VARCHAR(50) NOT NULL,
        assigned_at VARCHAR(50) NOT NULL,
        PRIMARY KEY (user_phone, tag)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS journeys (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        definition TEXT NOT NULL,
        is_active BOOLEAN DEFAULT false,
        created_at VARCHAR(50) NOT NULL,
        updated_at VARCHAR(50) NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS segments (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        rules TEXT NOT NULL,
        created_at VARCHAR(50) NOT NULL,
        updated_at VARCHAR(50) NOT NULL
      )
    `);

    await client.query(`
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

    await client.query(`
      CREATE TABLE IF NOT EXISTS triggers (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        event_type VARCHAR(50) NOT NULL,
        actions TEXT NOT NULL,
        created_at VARCHAR(50) NOT NULL,
        updated_at VARCHAR(50) NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS message_templates (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        text TEXT NOT NULL,
        category VARCHAR(50) NOT NULL,
        created_at VARCHAR(50) NOT NULL,
        updated_at VARCHAR(50) NOT NULL
      )
    `);

    // Seed default journey from workflows.json if empty
    const journeysCheck = await client.query('SELECT COUNT(*) FROM journeys');
    if (parseInt(journeysCheck.rows[0].count, 10) === 0) {
      logger.info('Seeding default journey into PostgreSQL...');
      const workflowPath = new URL('../journey-service/workflows.json', import.meta.url);
      const defaultWorkflow = await fs.promises.readFile(workflowPath, 'utf8');
      const workflowObj = JSON.parse(defaultWorkflow);
      const now = new Date().toISOString();
      await client.query(
        `INSERT INTO journeys (id, name, definition, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        ['default', 'Default Onboarding', JSON.stringify(workflowObj.default || workflowObj), true, now, now]
      );
    }

    // Seed default game configs if empty
    const gameConfigsCheck = await client.query('SELECT COUNT(*) FROM game_configs');
    if (parseInt(gameConfigsCheck.rows[0].count, 10) === 0) {
      logger.info('Seeding default game configs into PostgreSQL...');
      const now = new Date().toISOString();
      const defaultConfigs = [
        { level: 1, type: 'multiplication_11', time_limit: 10, reward: 10 },
        { level: 2, type: 'squares_5', time_limit: 10, reward: 10 },
        { level: 3, type: 'base_100_subtraction', time_limit: 15, reward: 15 },
        { level: 4, type: 'base_100_addition', time_limit: 15, reward: 15 },
        { level: 5, type: 'near_1000', time_limit: 20, reward: 20 }
      ];
      for (const config of defaultConfigs) {
        await client.query(
          `INSERT INTO game_configs (id, level, type, time_limit, reward, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [`game_lvl_${config.level}`, config.level, config.type, config.time_limit, config.reward, now, now]
        );
      }
    }

    logger.info('PostgreSQL schemas bootstrapped successfully.');
  } catch (err) {
    logger.error(`Error bootstrapping PostgreSQL database: ${err.message}`);
  } finally {
    client.release();
  }
}

// Helper Queries for SSE Dashboard Init
async function getCRMContacts() {
  const usersRes = await pgPool.query('SELECT * FROM users ORDER BY updated_at DESC');
  const tagsRes = await pgPool.query('SELECT * FROM user_tags');
  const perfRes = await pgPool.query('SELECT * FROM performance_data');

  const contacts = [];
  for (const user of usersRes.rows) {
    const userTags = tagsRes.rows.filter(t => t.user_phone === user.phone_number).map(t => t.tag);
    const userPerf = perfRes.rows.filter(p => p.user_phone === user.phone_number);
    const correctCount = userPerf.filter(p => p.is_correct === 1).length;
    const avgResponseTime = userPerf.length > 0
      ? Math.round(userPerf.reduce((sum, p) => sum + p.response_time_ms, 0) / userPerf.length)
      : 0;

    contacts.push({
      ...user,
      whatsapp_number: user.phone_number,
      grade: user.grade_segment,
      phone: user.parent_phone,
      tags: userTags,
      score: correctCount,
      avg_response_time: avgResponseTime,
      performances: userPerf
    });
  }
  return contacts;
}

async function getBehavioralLogs() {
  const res = await pgPool.query('SELECT * FROM behavioral_logs ORDER BY created_at DESC LIMIT 100');
  return res.rows.map(r => ({
    ...r,
    category: r.event_type,
    payload: JSON.parse(r.payload || '{}')
  }));
}

async function getActiveSessions() {
  const keys = await redis.keys('session:*');
  const sessions = {};
  for (const key of keys) {
    const val = await redis.get(key);
    if (val) {
      const phone = key.replace('session:', '');
      const s = JSON.parse(val);
      sessions[phone] = {
        phone,
        state: s.current_node_id,
        game_state: s.game_state || {},
        variables: s.variables || {}
      };
    }
  }
  return sessions;
}

// SSE Connection Pooling
let sseClients = [];

function broadcastSSE(type, data) {
  sseClients.forEach(client => {
    client.raw.write(`event: ${type}\n`);
    client.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  });
}

// Redis PubSub Connection to proxy Event Bus events to Dashboard
async function startEventBusBroadcaster() {
  const subClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  
  await subClient.subscribe(
    'whatsapp-incoming',
    'whatsapp-outgoing-logs',
    'game-events',
    'journey-events',
    'segment-events',
    'platform-resets'
  );

  subClient.on('message', async (channel, message) => {
    const event = JSON.parse(message);

    if (channel === 'whatsapp-incoming') {
      broadcastSSE('log', {
        id: event.event_id,
        timestamp: event.timestamp,
        category: 'WHATSAPP_IN',
        title: 'Message Received',
        description: `From ${event.user_id}: "${event.payload.text.replace(/\n/g, ' ')}"`,
        payload: event.payload
      });
    }

    if (channel === 'whatsapp-outgoing-logs') {
      broadcastSSE('log', {
        id: event.event_id,
        timestamp: event.timestamp,
        category: 'WHATSAPP_OUT',
        title: 'Message Sent',
        description: `To ${event.user_id}: "${event.payload.text.replace(/\n/g, ' ')}"`,
        payload: event.payload
      });
    }

    if (channel === 'game-events') {
      broadcastSSE('log', {
        id: event.event_id,
        timestamp: event.timestamp,
        category: 'GAME_EVENT',
        title: `Level ${event.payload.level} Answer`,
        description: event.payload.is_correct ? 'Correct answer submitted.' : 'Incorrect answer submitted.',
        payload: event.payload
      });
    }

    if (channel === 'journey-events') {
      // 1. Broadcast log
      broadcastSSE('log', {
        id: event.event_id,
        timestamp: event.timestamp,
        category: 'CRM_STATE',
        title: 'State Transitioned',
        description: `Workflow node changed to "${event.payload.current_node_id}"`,
        payload: event.payload
      });

      // 2. Broadcast state change
      broadcastSSE('state_change', {
        phone: event.user_id,
        session: {
          phone: event.user_id,
          state: event.payload.current_node_id,
          game_state: {}, // placeholder
          variables: event.payload.variables
        }
      });
    }

    if (channel === 'segment-events') {
      const isAdded = !!event.payload.tag_added;
      const tag = isAdded ? event.payload.tag_added : event.payload.tag_removed;
      
      broadcastSSE('log', {
        id: event.event_id,
        timestamp: event.timestamp,
        category: isAdded ? 'TAG_ASSIGNED' : 'TAG_REMOVED',
        title: 'Segment Updated',
        description: isAdded ? `Assigned tag "${tag}"` : `Removed tag "${tag}"`,
        payload: event.payload
      });

      // Fetch enriched contact and broadcast crm update
      const contacts = await getCRMContacts();
      const contact = contacts.find(c => c.phone_number === event.user_id);
      if (contact) {
        broadcastSSE('crm_update', { contact });
      }
    }

    if (channel === 'platform-resets') {
      if (event.payload.text === 'reset_done') {
        broadcastSSE('reset', {});
      }
    }
  });
}

// Webhook Verification (GET)
fastify.get('/api/whatsapp-webhook', async (request, reply) => {
  const query = request.query;
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === META_VERIFY_TOKEN) {
      return reply.code(200).send(challenge);
    } else {
      return reply.code(403).send('Forbidden');
    }
  }
  return reply.code(400).send('Bad Request');
});

// Incoming Message Webhook (POST)
fastify.post('/api/whatsapp-webhook', async (request, reply) => {
  const body = request.body || {};
  let phone = '';
  let text = '';
  let isButton = false;

  if (body.object === 'whatsapp_business_account') {
    try {
      const entry = body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const message = value?.messages?.[0];

      if (!message) return reply.code(200).send({ success: true });

      phone = message.from;
      if (message.type === 'text') {
        text = message.text?.body;
      } else if (message.type === 'interactive') {
        isButton = true;
        text = message.interactive?.button_reply?.title || '';
      } else {
        return reply.code(200).send({ success: true });
      }
    } catch (err) {
      return reply.code(500).send({ error: 'Internal Server Error' });
    }
  } else {
    phone = body.phone;
    text = body.text;
    isButton = !!body.isButton;
  }

  if (!phone || !text) {
    return reply.code(400).send({ error: 'Missing phone or text parameters.' });
  }

  try {
    const event = createEvent('USER_MESSAGE_RECEIVED', phone, { text, is_button: isButton });
    await publishEvent('whatsapp-incoming', event);
    return reply.code(200).send({ success: true, event_id: event.event_id });
  } catch (err) {
    return reply.code(500).send({ error: err.message });
  }
});

// Calendly Mock Webhook
fastify.post('/api/crm/book-demo', async (request, reply) => {
  const { phone } = request.body || {};
  if (!phone) return reply.code(400).send({ error: 'Phone required.' });

  try {
    // 1. Publish step completion event
    const event = createEvent('JOURNEY_STEP_COMPLETED', phone, {
      workflow_id: 'default',
      previous_node_id: 'PITCH_AND_CTA',
      current_node_id: 'COMPLETED',
      variables: { demoBooked: 'true' }
    });
    await publishEvent('journey-events', event);

    // 2. Publish outbound message event
    await publishEvent('outbound-notifications', {
      to: phone,
      text: `🎉 *Demo Confirmed!* Your session is scheduled. ZOOM link will be sent shortly. Ready to unlock your math superpower? Let's do this! 💪`,
      buttons: []
    });

    // 3. Update database record
    await pgPool.query(
      `UPDATE users SET lead_stage = 'Demo Booked', lead_score = 110, updated_at = $1 WHERE phone_number = $2`,
      [new Date().toISOString(), phone]
    );

    // 4. Trigger tag check
    const contacts = await getCRMContacts();
    const contact = contacts.find(c => c.phone_number === phone);
    if (contact) {
      broadcastSSE('crm_update', { contact });
    }

    return reply.code(200).send({ success: true });
  } catch (err) {
    return reply.code(500).send({ error: err.message });
  }
});

// Admin Nudge Follow-up
fastify.post('/api/admin/trigger-followup', async (request, reply) => {
  const { phone, day } = request.body || {};
  if (!phone || !day) return reply.code(400).send({ error: 'Phone and day required.' });

  try {
    let text = '';
    let buttons = [];

    if (day === 1) {
      text = `👋 Hey! We missed you yesterday!\nHere is a quick 2-second Vedic Trick: *Dividing by 9*.\n\nFor 23 ÷ 9:\n1. First digit *2* is the quotient.\n2. Add digits (2 + 3 = 5) -> this is the remainder.\nAnswer: *2 remainder 5*!\n\nWant to learn more shortcuts? Resume where you left off! 👇`;
      buttons = ["Resume Challenge 🚀", "Book Free Class 📅"];
    } else if (day === 2) {
      text = `"My daughter Aarohi used to cry during math homework. After just 3 classes of Vedic Maths, she calculates faster than me!" — Smita (Parent) 👩‍👧\n\nWatch Aarohi solve a 5-digit square root in 4 seconds: https://youtube.com/mock-video\n\nGive your child math confidence! 👇`;
      buttons = ["Book Free Class 📅", "Play Math Game 🎮"];
    } else if (day === 3) {
      text = `⏰ *Last Chance!*\n\nThe free 1-on-1 Vedic Maths slots are almost fully booked for this week. Only *3 spots* remain in your region.\n\nDon't miss this opportunity to triple your calculation speed! 👇`;
      buttons = ["Claim Free Spot Now 🎁"];
    }

    // Force node change in Redis session
    const data = await redis.get(`session:${phone}`);
    if (data) {
      const s = JSON.parse(data);
      s.current_node_id = (day === 1 || day === 3) ? 'PITCH_AND_CTA' : 'WELCOME';
      await redis.set(`session:${phone}`, JSON.stringify(s));
      
      broadcastSSE('state_change', {
        phone,
        session: {
          phone,
          state: s.current_node_id,
          game_state: s.game_state || {},
          variables: s.variables || {}
        }
      });
    }

    // Publish to notification stream
    await publishEvent('outbound-notifications', { to: phone, text, buttons });

    return { success: true };
  } catch (err) {
    return reply.code(500).send({ error: err.message });
  }
});

// Admin Reset
fastify.post('/api/admin/reset', async (request, reply) => {
  try {
    const event = createEvent('USER_MESSAGE_RECEIVED', 'SYSTEM', { text: 'reset', is_button: false });
    await publishEvent('whatsapp-incoming', event);
    return { success: true };
  } catch (err) {
    return reply.code(500).send({ error: err.message });
  }
});

// Proxy configuration endpoints to Config Service (Port 3007)
const CONFIG_SERVICE_URL = process.env.CONFIG_SERVICE_URL || 'http://localhost:3007';

fastify.route({
  method: ['GET', 'POST'],
  url: '/api/config/*',
  handler: async (request, reply) => {
    const targetUrl = `${CONFIG_SERVICE_URL}${request.url}`;
    const method = request.method;
    const headers = { 'Content-Type': 'application/json' };
    
    const fetchOptions = { method, headers };
    if (method === 'POST') {
      fetchOptions.body = JSON.stringify(request.body || {});
    }

    try {
      const res = await fetch(targetUrl, fetchOptions);
      const data = await res.json();
      return reply.code(res.status).send(data);
    } catch (err) {
      logger.error(`Error proxying config request to ${targetUrl}: ${err.message}`);
      return reply.code(500).send({ error: 'Config Service Unreachable' });
    }
  }
});

// CRM Contacts Endpoint
fastify.get('/api/crm/contacts', async (request, reply) => {
  const contacts = await getCRMContacts();
  return contacts;
});

// CRM Logs Endpoint
fastify.get('/api/crm/logs', async (request, reply) => {
  const logs = await getBehavioralLogs();
  return logs;
});

// SSE Events Endpoint
fastify.get('/api/events', async (request, reply) => {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  
  sseClients.push(reply);

  try {
    const contacts = await getCRMContacts();
    const logs = await getBehavioralLogs();
    const sessions = await getActiveSessions();

    reply.raw.write(`event: init\n`);
    reply.raw.write(`data: ${JSON.stringify({ contacts, logs, sessions })}\n\n`);
  } catch (err) {
    logger.error(`Error writing SSE init: ${err.message}`);
  }

  request.raw.on('close', () => {
    sseClients = sseClients.filter(c => c !== reply);
  });
});

// Start Server
const start = async () => {
  await bootstrapDatabase();
  await startEventBusBroadcaster();
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`🚀 API Gateway & SSE Broadcaster running on http://localhost:${PORT}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
