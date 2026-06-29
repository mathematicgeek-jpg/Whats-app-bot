/**
 * Vercel Serverless Function: /api/simulate
 * 
 * Frontend simulator compatibility endpoint.
 * Accepts the same payload the old api-gateway used, processes through
 * the journey engine inline, and returns bot responses synchronously.
 * 
 * Also serves dashboard data (CRM contacts, logs, session state).
 */

import { parseSimulatorPayload } from '../lib/parser.js';
import { processMessage } from '../lib/journeyEngine.js';
import { getSession, deleteSession, getAllSessions } from '../lib/stateManager.js';
import { query, bootstrapSchema } from '../lib/db.js';
import { logger } from '../lib/logger.js';

export default async function handler(req, res) {
  // Enable CORS for frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  await bootstrapSchema();

  // ============================================
  // GET — Dashboard data (contacts, logs, sessions)
  // ============================================
  if (req.method === 'GET') {
    try {
      // CRM Contacts
      const usersRes = await query('SELECT * FROM users ORDER BY updated_at DESC');
      const tagsRes = await query('SELECT * FROM user_tags');
      const perfRes = await query('SELECT * FROM performance_data');

      const contacts = usersRes.rows.map(user => {
        const userTags = tagsRes.rows.filter(t => t.user_phone === user.phone_number).map(t => t.tag);
        const userPerf = perfRes.rows.filter(p => p.user_phone === user.phone_number);
        const correctCount = userPerf.filter(p => p.is_correct === 1).length;
        const avgResponseTime = userPerf.length > 0
          ? Math.round(userPerf.reduce((sum, p) => sum + p.response_time_ms, 0) / userPerf.length)
          : 0;

        return {
          ...user,
          whatsapp_number: user.phone_number,
          grade: user.grade_segment,
          phone: user.parent_phone,
          tags: userTags,
          score: correctCount,
          avg_response_time: avgResponseTime,
          performances: userPerf
        };
      });

      // Behavioral Logs (last 100)
      const logsRes = await query('SELECT * FROM behavioral_logs ORDER BY created_at DESC LIMIT 100');
      const logs = logsRes.rows.map(r => ({
        ...r,
        category: r.event_type,
        payload: (() => { try { return JSON.parse(r.payload || '{}'); } catch { return {}; } })()
      }));

      // Active Sessions
      const sessions = await getAllSessions();

      return res.status(200).json({ contacts, logs, sessions });
    } catch (err) {
      logger.error('Failed to fetch dashboard data', { error: err.message });
      return res.status(500).json({ error: err.message });
    }
  }

  // ============================================
  // POST — Simulate a message
  // ============================================
  if (req.method === 'POST') {
    const body = req.body || {};

    // Handle admin actions
    if (body.action === 'reset') {
      return handleReset(req, res);
    }
    if (body.action === 'book-demo') {
      return handleBookDemo(req, res, body.phone);
    }
    if (body.action === 'trigger-followup') {
      return handleFollowup(req, res, body.phone, body.day);
    }

    const { phone, text } = body;
    if (!phone || !text) {
      return res.status(400).json({ error: 'Missing phone or text parameters' });
    }

    const parsed = parseSimulatorPayload(body);

    try {
      // Process through journey engine (sendMessages=false to return responses)
      const result = await processMessage(parsed, { sendMessages: false });

      return res.status(200).json({
        success: true,
        responses: result.messages,
        session: result.session
      });
    } catch (err) {
      logger.error('Simulate error', { error: err.message, phone });
      return res.status(500).json({ error: err.message });
    }
  }

  // ============================================
  // DELETE — Reset all data
  // ============================================
  if (req.method === 'DELETE') {
    return handleReset(req, res);
  }

  res.setHeader('Allow', 'GET, POST, DELETE, OPTIONS');
  return res.status(405).json({ error: 'Method not allowed' });
}


// ============================================
// Admin Action Handlers
// ============================================

async function handleReset(req, res) {
  try {
    await query('DELETE FROM user_tags');
    await query('DELETE FROM performance_data');
    await query('DELETE FROM behavioral_logs');
    await query('DELETE FROM sessions');
    await query('DELETE FROM users');
    logger.info('System reset: all data cleared');
    return res.status(200).json({ success: true });
  } catch (err) {
    logger.error('Reset failed', { error: err.message });
    return res.status(500).json({ error: err.message });
  }
}

async function handleBookDemo(req, res, phone) {
  if (!phone) return res.status(400).json({ error: 'Phone required' });

  try {
    await query(
      `UPDATE users SET lead_stage = 'Demo Booked', lead_score = 110, updated_at = $1 WHERE phone_number = $2`,
      [new Date().toISOString(), phone]
    );
    return res.status(200).json({
      success: true,
      responses: [{
        text: `🎉 *Demo Confirmed!* Your session is scheduled. ZOOM link will be sent shortly. Ready to unlock your math superpower? Let's do this! 💪`
      }]
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function handleFollowup(req, res, phone, day) {
  if (!phone || !day) return res.status(400).json({ error: 'Phone and day required' });

  const followups = {
    1: {
      text: "👋 Hey! We missed you yesterday!\nHere is a quick 2-second Vedic Trick: *Dividing by 9*.\n\nFor 23 ÷ 9:\n1. First digit *2* is the quotient.\n2. Add digits (2 + 3 = 5) -> this is the remainder.\nAnswer: *2 remainder 5*!\n\nWant to learn more shortcuts? Resume where you left off! 👇",
      buttons: ["Resume Challenge 🚀", "Book Free Class 📅"]
    },
    2: {
      text: "\"My daughter Aarohi used to cry during math homework. After just 3 classes of Vedic Maths, she calculates faster than me!\" — Smita (Parent) 👩‍👧\n\nWatch Aarohi solve a 5-digit square root in 4 seconds: https://youtube.com/mock-video\n\nGive your child math confidence! 👇",
      buttons: ["Book Free Class 📅", "Play Math Game 🎮"]
    },
    3: {
      text: "⏰ *Last Chance!*\n\nThe free 1-on-1 Vedic Maths slots are almost fully booked for this week. Only *3 spots* remain in your region.\n\nDon't miss this opportunity to triple your calculation speed! 👇",
      buttons: ["Claim Free Spot Now 🎁"]
    }
  };

  const followup = followups[day];
  if (!followup) return res.status(400).json({ error: 'Invalid day (1-3)' });

  return res.status(200).json({
    success: true,
    responses: [followup]
  });
}
