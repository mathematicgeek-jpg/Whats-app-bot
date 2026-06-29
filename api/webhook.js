/**
 * Vercel Serverless Function: /api/webhook
 * 
 * Meta WhatsApp Cloud API webhook handler.
 * - GET: Webhook verification (hub.mode, hub.verify_token, hub.challenge)
 * - POST: Incoming message processing with signature validation and idempotency
 */

import { parseWebhookPayload } from '../lib/parser.js';
import { processMessage } from '../lib/journeyEngine.js';
import { isProcessed } from '../lib/stateManager.js';
import { validateSignature } from '../lib/security.js';
import { logger } from '../lib/logger.js';

export default async function handler(req, res) {
  // ============================================
  // GET — Webhook Verification
  // ============================================
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const verifyToken = process.env.META_VERIFY_TOKEN || 'MATH_GEEK_BOT_VERIFY_TOKEN';

    if (mode && token) {
      if (mode === 'subscribe' && token === verifyToken) {
        logger.info('Webhook verification successful');
        return res.status(200).send(challenge);
      } else {
        logger.warn('Webhook verification failed — token mismatch');
        return res.status(403).send('Forbidden');
      }
    }
    return res.status(400).send('Bad Request');
  }

  // ============================================
  // POST — Incoming Message
  // ============================================
  if (req.method === 'POST') {
    const body = req.body;

    // Validate webhook signature if app secret is configured
    const appSecret = process.env.META_APP_SECRET;
    if (appSecret && !appSecret.includes('your_meta_app_secret')) {
      const signature = req.headers['x-hub-signature-256'];
      const rawBody = typeof body === 'string' ? body : JSON.stringify(body);

      if (!validateSignature(rawBody, signature, appSecret)) {
        logger.warn('Webhook signature validation failed');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    // Parse the incoming payload
    const parsed = parseWebhookPayload(body);

    // Status update or non-message event — acknowledge silently
    if (!parsed) {
      return res.status(200).json({ success: true, type: 'status_update' });
    }

    // Idempotency check — skip if already processed
    const isDuplicate = await isProcessed(parsed.messageId);
    if (isDuplicate) {
      logger.debug('Duplicate message skipped', { messageId: parsed.messageId });
      return res.status(200).json({ success: true, type: 'duplicate' });
    }

    logger.info('Processing incoming message', {
      phone: parsed.phone,
      type: parsed.type,
      text: parsed.text.substring(0, 50),
      messageId: parsed.messageId
    });

    try {
      // Run the full pipeline: state → journey → respond → save
      await processMessage(parsed, { sendMessages: true });

      return res.status(200).json({ success: true });
    } catch (err) {
      logger.error('Error processing webhook message', {
        error: err.message,
        phone: parsed.phone,
        messageId: parsed.messageId
      });
      // Always return 200 to prevent Meta from retrying
      return res.status(200).json({ success: true, error: 'internal' });
    }
  }

  // Unsupported method
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
