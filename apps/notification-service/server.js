import { startConsumer, publishEvent } from '@mathgeek/event-bus';
import { createEvent } from '@mathgeek/event-schema';
import { logger } from '@mathgeek/utils';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

// Outbound Consumer
async function start() {
  logger.info('Starting Notification Service consumer...');

  await startConsumer('notification-group', 'outbound-notifications', async (event) => {
    const { to, text, buttons } = event;
    logger.info(`Sending WhatsApp message to ${to}: "${text.replace(/\n/g, ' ')}"`);
    
    // Call Meta API if set
    await sendMetaWhatsAppMessage(to, text, buttons);

    // Publish to main events topic so it is captured in behavioral logs
    await publishEvent('whatsapp-outgoing-logs', createEvent('USER_MESSAGE_RECEIVED', to, {
      text,
      is_button: buttons && buttons.length > 0,
      direction: 'outbound'
    }));
  });
}

/**
 * Dispatches message via Meta Cloud API
 */
async function sendMetaWhatsAppMessage(phone, text, buttons) {
  const token = process.env.META_ACCESS_TOKEN;
  const phoneId = process.env.META_PHONE_NUMBER_ID;

  if (!token || !phoneId || token.includes('your_meta_system_user_access_token') || phoneId.includes('your_whatsapp_phone_number_id')) {
    logger.debug('Meta credentials not configured. Skipping Meta API HTTP call.');
    return;
  }

  let payload = {};
  if (buttons && buttons.length > 0) {
    payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text },
        action: {
          buttons: buttons.map((btn, idx) => ({
            type: "reply",
            reply: {
              id: `btn_${idx}`,
              title: btn.substring(0, 20)
            }
          }))
        }
      }
    };
  } else {
    payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
      type: "text",
      text: { body: text }
    };
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      logger.error('Meta Cloud API returned error:', data);
    } else {
      logger.info(`Meta Cloud API message sent. wamid=${data.messages?.[0]?.id}`);
    }
  } catch (err) {
    logger.error(`Network error calling Meta Cloud API: ${err.message}`);
  }
}

start().catch(err => {
  logger.error(`Notification Service startup failure: ${err.message}`);
  process.exit(1);
});
