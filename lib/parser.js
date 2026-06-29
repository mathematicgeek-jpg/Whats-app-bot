/**
 * WhatsApp webhook payload parser.
 * Extracts and normalizes incoming messages from Meta's webhook structure.
 * 
 * Meta payload structure:
 *   entry[0].changes[0].value.messages[0]
 */

import { logger } from './logger.js';

/**
 * Parse a Meta WhatsApp Cloud API webhook payload.
 * @param {object} body - The parsed JSON request body
 * @returns {object|null} Normalized message object or null if not a user message
 * 
 * Returned object shape:
 * {
 *   phone: string,      // sender phone (E.164)
 *   text: string,       // message text content
 *   type: string,       // 'text' | 'button' | 'list' | 'unknown'
 *   isButton: boolean,  // true if interactive button reply
 *   messageId: string,  // WhatsApp message ID (for idempotency)
 *   timestamp: string,  // message timestamp
 *   raw: object         // raw message object from Meta
 * }
 */
export function parseWebhookPayload(body) {
  if (!body || body.object !== 'whatsapp_business_account') {
    return null;
  }

  try {
    const entry = body.entry?.[0];
    if (!entry) return null;

    const change = entry.changes?.[0];
    if (!change) return null;

    const value = change.value;
    if (!value) return null;

    // Status updates (delivery receipts, read receipts) — no messages array
    if (!value.messages || value.messages.length === 0) {
      logger.debug('Webhook payload is a status update, skipping', {
        statuses: value.statuses?.length || 0
      });
      return null;
    }

    const message = value.messages[0];
    const contact = value.contacts?.[0];

    let text = '';
    let type = 'unknown';
    let isButton = false;

    switch (message.type) {
      case 'text':
        text = message.text?.body || '';
        type = 'text';
        break;

      case 'interactive':
        isButton = true;
        if (message.interactive?.type === 'button_reply') {
          text = message.interactive.button_reply?.title || '';
          type = 'button';
        } else if (message.interactive?.type === 'list_reply') {
          text = message.interactive.list_reply?.title || '';
          type = 'list';
        }
        break;

      case 'image':
      case 'video':
      case 'audio':
      case 'document':
      case 'sticker':
        type = message.type;
        text = message[message.type]?.caption || '';
        break;

      case 'location':
        type = 'location';
        text = `Location: ${message.location?.latitude},${message.location?.longitude}`;
        break;

      default:
        logger.debug(`Unsupported message type: ${message.type}`);
        type = 'unknown';
    }

    return {
      phone: message.from,
      text,
      type,
      isButton,
      messageId: message.id,
      timestamp: message.timestamp,
      contactName: contact?.profile?.name || null,
      raw: message
    };
  } catch (err) {
    logger.error('Failed to parse webhook payload', { error: err.message });
    return null;
  }
}

/**
 * Parse a simulator request body (from the frontend).
 * @param {object} body - { phone, text, isButton }
 * @returns {object} Normalized message object
 */
export function parseSimulatorPayload(body) {
  return {
    phone: body.phone || '',
    text: body.text || '',
    type: body.isButton ? 'button' : 'text',
    isButton: !!body.isButton,
    messageId: `sim_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    timestamp: String(Math.floor(Date.now() / 1000)),
    contactName: null,
    raw: body
  };
}
