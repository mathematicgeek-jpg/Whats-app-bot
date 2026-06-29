/**
 * Vercel Serverless Function: /api/journeys/[id]
 * 
 * Single journey operations.
 * - GET: Fetch a journey by ID
 * - PUT: Update a journey definition
 * - DELETE: Delete a journey
 */

import { query, bootstrapSchema } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';

export default async function handler(req, res) {
  await bootstrapSchema();

  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Journey ID is required' });
  }

  // ============================================
  // GET — Fetch journey by ID
  // ============================================
  if (req.method === 'GET') {
    try {
      const result = await query('SELECT * FROM journeys WHERE id = $1', [id]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Journey not found' });
      }
      const row = result.rows[0];
      return res.status(200).json({
        ...row,
        definition: typeof row.definition === 'string' ? JSON.parse(row.definition) : row.definition
      });
    } catch (err) {
      logger.error('Failed to fetch journey', { error: err.message, id });
      return res.status(500).json({ error: err.message });
    }
  }

  // ============================================
  // PUT — Update a journey
  // ============================================
  if (req.method === 'PUT') {
    const { name, definition, is_active } = req.body || {};

    if (!name && !definition && is_active === undefined) {
      return res.status(400).json({ error: 'At least one field (name, definition, is_active) is required' });
    }

    try {
      // Check if journey exists
      const existing = await query('SELECT * FROM journeys WHERE id = $1', [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Journey not found' });
      }

      const now = new Date().toISOString();
      const updates = [];
      const params = [];
      let paramIdx = 1;

      if (name !== undefined) {
        updates.push(`name = $${paramIdx++}`);
        params.push(name);
      }
      if (definition !== undefined) {
        updates.push(`definition = $${paramIdx++}`);
        params.push(typeof definition === 'string' ? definition : JSON.stringify(definition));
      }
      if (is_active !== undefined) {
        updates.push(`is_active = $${paramIdx++}`);
        params.push(!!is_active);
      }
      updates.push(`updated_at = $${paramIdx++}`);
      params.push(now);
      params.push(id);

      await query(
        `UPDATE journeys SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
        params
      );

      // If setting active, deactivate other journeys
      if (is_active) {
        await query('UPDATE journeys SET is_active = false WHERE id != $1', [id]);
      }

      logger.info('Journey updated', { id });
      return res.status(200).json({ success: true });
    } catch (err) {
      logger.error('Failed to update journey', { error: err.message, id });
      return res.status(500).json({ error: err.message });
    }
  }

  // ============================================
  // DELETE — Delete a journey
  // ============================================
  if (req.method === 'DELETE') {
    try {
      const result = await query('DELETE FROM journeys WHERE id = $1', [id]);
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Journey not found' });
      }
      logger.info('Journey deleted', { id });
      return res.status(200).json({ success: true });
    } catch (err) {
      logger.error('Failed to delete journey', { error: err.message, id });
      return res.status(500).json({ error: err.message });
    }
  }

  res.setHeader('Allow', 'GET, PUT, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
