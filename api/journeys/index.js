/**
 * Vercel Serverless Function: /api/journeys
 * 
 * Admin CRUD for journey definitions.
 * - GET: List all journeys
 * - POST: Create or upsert a journey
 */

import { query, bootstrapSchema } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';

export default async function handler(req, res) {
  // Enable CORS for frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    await bootstrapSchema();
  } catch (err) {
    logger.error('Database bootstrap failed', { error: err.message });
  }

  // ============================================
  // GET — List all journeys
  // ============================================
  if (req.method === 'GET') {
    try {
      const result = await query('SELECT * FROM journeys ORDER BY updated_at DESC');
      const journeys = result.rows.map(r => ({
        ...r,
        definition: typeof r.definition === 'string' ? JSON.parse(r.definition) : r.definition
      }));
      return res.status(200).json(journeys);
    } catch (err) {
      logger.error('Failed to list journeys', { error: err.message });
      return res.status(500).json({ error: err.message });
    }
  }

  // ============================================
  // POST — Create/Upsert a journey
  // ============================================
  if (req.method === 'POST') {
    const { id, name, definition, is_active } = req.body || {};

    if (!id || !name || !definition) {
      return res.status(400).json({ error: 'id, name, and definition are required' });
    }

    try {
      const now = new Date().toISOString();
      const defString = typeof definition === 'string' ? definition : JSON.stringify(definition);

      await query(
        `INSERT INTO journeys (id, name, definition, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           definition = EXCLUDED.definition,
           is_active = EXCLUDED.is_active,
           updated_at = EXCLUDED.updated_at`,
        [id, name, defString, !!is_active, now, now]
      );

      // If setting active, deactivate other journeys
      if (is_active) {
        await query('UPDATE journeys SET is_active = false WHERE id != $1', [id]);
      }

      logger.info('Journey upserted', { id, name, is_active: !!is_active });
      return res.status(200).json({ success: true });
    } catch (err) {
      logger.error('Failed to upsert journey', { error: err.message });
      return res.status(500).json({ error: err.message });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
