/**
 * Meta WhatsApp Cloud API client.
 * Sends messages via the Graph API (v20.0).
 * Supports text messages, interactive buttons, and templates.
 */

import { logger } from './logger.js';

const API_VERSION = 'v20.0';

/**
 * Send a plain text message.
 * @param {string} phone - Recipient phone number (E.164)
 * @param {string} text - Message body
 */
export async function sendTextMessage(phone, text) {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone,
    type: 'text',
    text: { body: text }
  };
  return callMetaAPI(payload);
}

/**
 * Send an interactive button message.
 * @param {string} phone - Recipient phone number
 * @param {string} text - Message body
 * @param {string[]} buttons - Button titles (max 3, each truncated to 20 chars)
 */
export async function sendButtonMessage(phone, text, buttons) {
  if (!buttons || buttons.length === 0) {
    return sendTextMessage(phone, text);
  }

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text },
      action: {
        buttons: buttons.slice(0, 3).map((btn, idx) => ({
          type: 'reply',
          reply: {
            id: `btn_${idx}`,
            title: String(btn).substring(0, 20)
          }
        }))
      }
    }
  };
  return callMetaAPI(payload);
}

/**
 * Send a template message.
 * @param {string} phone - Recipient phone number
 * @param {string} templateName - Template name
 * @param {string} languageCode - Language code (default: 'en')
 * @param {Array} components - Template components parameters
 */
export async function sendTemplateMessage(phone, templateName, languageCode = 'en', components = []) {
  const payload = {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components
    }
  };
  return callMetaAPI(payload);
}

/**
 * Internal: Call the Meta Graph API.
 * @param {object} payload - API request payload
 * @returns {object|null} API response data or null on failure
 */
async function callMetaAPI(payload) {
  const token = process.env.META_ACCESS_TOKEN;
  const phoneId = process.env.META_PHONE_NUMBER_ID;

  if (!token || !phoneId ||
      token.includes('your_meta_system_user_access_token') ||
      phoneId.includes('your_whatsapp_phone_number_id')) {
    logger.debug('Meta credentials not configured — skipping API call', {
      to: payload.to,
      type: payload.type
    });
    return null;
  }

  const url = `https://graph.facebook.com/${API_VERSION}/${phoneId}/messages`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok) {
      logger.error('Meta Cloud API returned error', {
        status: res.status,
        error: data.error,
        to: payload.to
      });
      return null;
    }

    logger.info('Meta Cloud API message sent', {
      to: payload.to,
      type: payload.type,
      wamid: data.messages?.[0]?.id
    });

    return data;
  } catch (err) {
    logger.error('Network error calling Meta Cloud API', {
      error: err.message,
      to: payload.to
    });
    return null;
  }
}
