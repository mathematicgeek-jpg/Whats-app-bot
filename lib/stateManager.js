/**
 * User session/state management via Upstash Redis (HTTP-based).
 * Falls back to ioredis for local development.
 * 
 * Session schema:
 * {
 *   phone, currentWorkflowId, currentNodeId,
 *   gameState: { level, correctCount, attempts, isHardMode, questionSentTime },
 *   variables: { name, grade, city, parentPhone, ... },
 *   createdAt, updatedAt
 * }
 */

import { logger } from './logger.js';

const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days in seconds
const IDEMPOTENCY_TTL = 60 * 5; // 5 minutes

let _client = null;
let _clientType = null; // 'upstash' or 'ioredis'

/**
 * Get or create Redis client.
 */
async function getClient() {
  if (_client) return { client: _client, type: _clientType };

  const upstashUrl = (process.env.UPSTASH_REDIS_REST_URL || '').trim();
  const upstashToken = (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();

  // Try Upstash first (serverless-native)
  if (upstashUrl && upstashToken) {
    try {
      const { Redis } = await import('@upstash/redis');
      _client = new Redis({ url: upstashUrl, token: upstashToken });
      _clientType = 'upstash';
      logger.info('State Manager: Using Upstash Redis (HTTP)');
      return { client: _client, type: _clientType };
    } catch (err) {
      logger.warn('Upstash Redis not available, falling back to ioredis', { error: err.message });
    }
  }

  // Fallback: ioredis (local development)
  try {
    const Redis = (await import('ioredis')).default;
    _client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    _client.on('error', (err) => {
      logger.error('Redis connection error', { error: err.message });
    });
    _clientType = 'ioredis';
    logger.info('State Manager: Using ioredis (TCP)');
    return { client: _client, type: _clientType };
  } catch (err) {
    logger.error('Failed to connect to any Redis instance', { error: err.message });
    throw err;
  }
}

/**
 * Get user session by phone number.
 * @param {string} phone
 * @returns {object|null}
 */
export async function getSession(phone) {
  const { client, type } = await getClient();
  const key = `session:${phone}`;

  const data = await client.get(key);
  if (!data) return null;

  return typeof data === 'string' ? JSON.parse(data) : data;
}

/**
 * Save user session.
 * @param {string} phone
 * @param {object} session
 */
export async function saveSession(phone, session) {
  const { client, type } = await getClient();
  const key = `session:${phone}`;
  session.updatedAt = new Date().toISOString();

  const value = JSON.stringify(session);

  if (type === 'upstash') {
    await client.set(key, value, { ex: SESSION_TTL });
  } else {
    await client.set(key, value, 'EX', SESSION_TTL);
  }
}

/**
 * Delete user session.
 * @param {string} phone
 */
export async function deleteSession(phone) {
  const { client } = await getClient();
  await client.del(`session:${phone}`);
}

/**
 * Check if a message has already been processed (idempotency).
 * Uses SET NX with 5-minute TTL.
 * @param {string} messageId - WhatsApp message ID (wamid)
 * @returns {boolean} true if already processed (duplicate)
 */
export async function isProcessed(messageId) {
  if (!messageId) return false;

  const { client, type } = await getClient();
  const key = `processed:${messageId}`;

  if (type === 'upstash') {
    // Upstash: set returns 'OK' if key was set (NX = only if not exists)
    const result = await client.set(key, '1', { nx: true, ex: IDEMPOTENCY_TTL });
    return result === null; // null means key already existed
  } else {
    // ioredis: returns 'OK' if set, null if key existed
    const result = await client.set(key, '1', 'NX', 'EX', IDEMPOTENCY_TTL);
    return result === null;
  }
}

/**
 * Get all active sessions (for admin/simulate dashboard).
 * @returns {object} { [phone]: sessionData }
 */
export async function getAllSessions() {
  const { client, type } = await getClient();
  const sessions = {};

  if (type === 'ioredis') {
    const keys = await client.keys('session:*');
    for (const key of keys) {
      const val = await client.get(key);
      if (val) {
        const phone = key.replace('session:', '');
        const s = JSON.parse(val);
        sessions[phone] = {
          phone,
          state: s.currentNodeId,
          gameState: s.gameState || {},
          variables: s.variables || {}
        };
      }
    }
  } else {
    // Upstash: SCAN is available but we'll skip for now
    // Sessions will be fetched individually by phone in the simulate endpoint
    logger.debug('getAllSessions not fully supported on Upstash — use per-phone lookup');
  }

  return sessions;
}
