import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { 
  initDatabase, 
  getOrCreateUser, 
  updateUser, 
  saveSession, 
  getSession, 
  logEvent, 
  getCRMContacts, 
  getBehavioralLogs, 
  resetDatabaseData, 
  dbEvents,
  getEnrichedContact,
  dbAll
} from './database.js';
import { handleMessage } from './journeyEngine.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'MATH_GEEK_BOT_VERIFY_TOKEN';

app.use(cors());
app.use(express.json());

// ==========================================
// SSE BROADCAST MECHANISM
// ==========================================
let sseClients = [];

function broadcast(type, data) {
  sseClients.forEach(client => {
    client.write(`event: ${type}\n`);
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  });
}

// Hook Database Events to SSE Broadcast
dbEvents.on('log', (log) => {
  broadcast('log', log);
});

dbEvents.on('crm_update', (data) => {
  broadcast('crm_update', data);
});

dbEvents.on('state_change', (data) => {
  broadcast('state_change', data);
});

dbEvents.on('reset', () => {
  broadcast('reset', {});
});

// ==========================================
// OUTGOING MESSAGE DISPATCH (META & SIMULATOR)
// ==========================================

async function sendMetaWhatsAppMessages(phone, responses) {
  const token = process.env.META_ACCESS_TOKEN;
  const phoneId = process.env.META_PHONE_NUMBER_ID;

  if (!token || !phoneId) {
    console.log('⚠️ Meta credentials not set. Outgoing API message dispatch skipped.');
    return;
  }

  for (const resp of responses) {
    let payload = {};
    if (resp.buttons && resp.buttons.length > 0) {
      payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: phone,
        type: "interactive",
        interactive: {
          type: "button",
          body: {
            text: resp.text
          },
          action: {
            buttons: resp.buttons.map((btn, idx) => ({
              type: "reply",
              reply: {
                id: `btn_${idx}`,
                title: btn.substring(0, 20) // Meta limit
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
        text: {
          body: resp.text
        }
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
        console.error('❌ Error sending message via Meta API:', data);
      } else {
        console.log(`✅ Message sent via Meta API: wamid=${data.messages?.[0]?.id}`);
      }
    } catch (err) {
      console.error('❌ Network error sending message via Meta API:', err);
    }
  }
}

// ==========================================
// HTTP ENDPOINTS
// ==========================================

// Webhook Verification from Meta (GET)
app.get('/api/whatsapp-webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === META_VERIFY_TOKEN) {
      console.log('✅ Webhook verified by Meta successfully');
      return res.status(200).send(challenge);
    } else {
      console.log('❌ Webhook verification failed: Invalid verify token');
      return res.sendStatus(403);
    }
  }
  res.sendStatus(400);
});

// Incoming Message Webhook (POST)
app.post('/api/whatsapp-webhook', async (req, res) => {
  // 1. Detect if it's a Meta Webhook request
  if (req.body.object === 'whatsapp_business_account') {
    try {
      const entry = req.body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const message = value?.messages?.[0];

      if (!message) {
        return res.status(200).json({ success: true, message: 'No message in webhook payload' });
      }

      const phone = message.from;
      let text = '';
      let isButton = false;

      if (message.type === 'text') {
        text = message.text?.body;
      } else if (message.type === 'interactive') {
        isButton = true;
        text = message.interactive?.button_reply?.title || '';
      } else {
        return res.status(200).json({ success: true, message: `Unhandled message type: ${message.type}` });
      }

      console.log(`🤖 Received Meta Webhook: phone=${phone}, text="${text}", isButton=${isButton}`);
      
      // Process through Journey Engine
      const botResponses = await handleMessage(phone, text, isButton);
      
      // Send actual responses back via Meta Cloud API if configured
      await sendMetaWhatsAppMessages(phone, botResponses);

      // Log outbound messages in behavioral logs
      for (const resp of botResponses) {
        await logEvent(phone, 'WHATSAPP_OUT', 'Message Sent (Meta API)', `To ${phone}: "${resp.text.replace(/\n/g, ' ')}"`, resp);
      }

      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('Error parsing Meta Webhook:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  // 2. Fallback to simulator flat payload structure
  const { phone, text, isButton } = req.body;
  if (!phone || !text) {
    return res.status(400).json({ error: 'Missing phone or text parameters' });
  }

  try {
    const botResponses = await handleMessage(phone, text, isButton);
    
    // Log outbound messages in database
    for (const resp of botResponses) {
      await logEvent(phone, 'WHATSAPP_OUT', 'Message Sent', `To ${phone}: "${resp.text.replace(/\n/g, ' ')}"`, resp);
    }
    
    res.status(200).json({ success: true, responses: botResponses });
  } catch (err) {
    console.error('Error processing message in journey engine:', err);
    res.status(500).json({ error: 'Internal server error processing message' });
  }
});

// CRM Contacts
app.get('/api/crm/contacts', async (req, res) => {
  try {
    const contacts = await getCRMContacts();
    res.json(contacts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CRM Logs
app.get('/api/crm/logs', async (req, res) => {
  try {
    const logs = await getBehavioralLogs();
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Calendly Mock Demo Booking Webhook
app.post('/api/crm/book-demo', async (req, res) => {
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ error: 'Valid contact phone required' });
  }

  try {
    const contact = await getEnrichedContact(phone);
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // 1. Update User stage & score in DB
    await updateUser(phone, {
      lead_stage: 'Demo Booked',
      lead_score: 110
    });

    // 2. Update session state
    let session = await getSession(phone);
    if (session) {
      session.current_node_id = 'COMPLETED';
      session.variables.demoBooked = 'true';
      await saveSession(phone, session);
    }

    // 3. Log Webhook
    const payload = {
      event: "invitee.created",
      payload: {
        email: "parent@example.com",
        name: contact.name || 'Student',
        phone: phone,
        tracking: {
          utm_source: "whatsapp_funnel"
        }
      }
    };
    
    await logEvent(phone, 'CRM_WEBHOOK', 'Calendly Invite Webhook Received', 'Webhook from Calendly matched contact and updated status.', payload);
    await logEvent(phone, 'CRM_STATE', 'Lead Stage Updated', `Lead stage for ${contact.name || phone} changed to "Demo Booked"`, contact);

    // 4. Alert Slack
    const slackPayload = {
      text: `🎉 *NEW DEMO BOOKED* 🎉\n\n*Student:* ${contact.name || 'Student'}\n*Grade:* ${contact.grade_segment || 'N/A'}\n*Phone:* ${phone}\n*Score:* ${contact.score}/5\n*Pipeline Stage:* Demo Booked 📅`,
      channel: "#sales-alerts"
    };
    await logEvent(phone, 'SALES_ALERT', 'Slack Notification Dispatched', 'Notified #sales-alerts of demo class booking confirmation.', slackPayload);

    // 5. Send Outbound confirmation
    const confirmationText = `🎉 *Demo Confirmed, ${contact.name || 'Math Wizard'}!* \n\nYour 1-on-1 session is scheduled. Our team will message you the Zoom link 15 minutes before the class.\n\nReady to unlock your math superpower? Let's do this! 💪`;
    await logEvent(phone, 'WHATSAPP_OUT', 'Message Sent', `To ${phone}: "Demo Confirmed..."`, { to: phone, text: confirmationText });

    const updatedContact = await getEnrichedContact(phone);
    res.json({ success: true, contact: updatedContact });
  } catch (err) {
    console.error('Error booking demo:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin Follow-up Trigger
app.post('/api/admin/trigger-followup', async (req, res) => {
  const { phone, day } = req.body;
  if (!phone) {
    return res.status(400).json({ error: 'Phone number required' });
  }

  try {
    let session = await getSession(phone);
    if (!session) {
      return res.status(404).json({ error: 'Active session not found' });
    }

    let text = '';
    let buttons = [];

    if (day === 1) {
      text = `👋 Hey! We missed you yesterday!\nHere is a quick 2-second Vedic Trick: *Dividing by 9*.\n\nFor 23 ÷ 9:\n1. First digit *2* is the quotient.\n2. Add digits (2 + 3 = 5) -> this is the remainder.\nAnswer: *2 remainder 5*!\n\nWant to learn more shortcuts? Resume where you left off! 👇`;
      buttons = ["Resume Challenge 🚀", "Book Free Class 📅"];
    } else if (day === 2) {
      text = `"My daughter Aarohi used to cry during math homework. After just 3 classes of Vedic Maths, she calculates faster than me!" — Smita (Parent) 👩‍👧\n\nWatch Aarohi solve a 5-digit square root in 4 seconds: https://youtube.com/mock-video\n\nGive your child math confidence! 👇`;
      buttons = ["Book Free Class 📅", "Play Math Game 🎮"];
    } else if (day === 3) {
      text = `⏰ *Last Chance, ${session.variables.name || 'Math Wizard'}!*\n\nThe free 1-on-1 Vedic Maths assessment slots are almost fully booked for this week. Only *3 spots* remain in your region.\n\nDon't miss this opportunity to triple your calculation speed! 👇`;
      buttons = ["Claim Free Spot Now 🎁"];
    } else {
      return res.status(400).json({ error: 'Invalid day. Must be 1, 2, or 3.' });
    }

    // Force session node update
    if (day === 1 || day === 3) {
      session.current_node_id = 'PITCH_AND_CTA';
    } else if (day === 2) {
      session.current_node_id = 'WELCOME';
    }
    await saveSession(phone, session);

    await logEvent(phone, 'WHATSAPP_OUT', `Follow-up Sent (Day ${day})`, `Sent follow-up automation nudge to ${phone}`, { to: phone, text, buttons });
    res.json({ success: true, message: `Follow-up Day ${day} sent` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Reset
app.post('/api/admin/reset', async (req, res) => {
  try {
    await resetDatabaseData();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SSE Events Endpoint
app.get('/api/events', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.push(res);

  try {
    const contacts = await getCRMContacts();
    const logs = await getBehavioralLogs();
    const sessionRows = await dbAll('SELECT * FROM sessions');
    
    const sessionsObj = {};
    for (const r of sessionRows) {
      sessionsObj[r.user_phone] = {
        phone: r.user_phone,
        state: r.current_node_id,
        game_state: JSON.parse(r.game_state || '{}'),
        variables: JSON.parse(r.variables || '{}')
      };
    }

    // Initial sync
    res.write(`event: init\n`);
    res.write(`data: ${JSON.stringify({
      contacts,
      logs,
      sessions: sessionsObj
    })}\n\n`);

  } catch (err) {
    console.error('Error fetching init data for SSE:', err);
  }

  req.on('close', () => {
    sseClients = sseClients.filter(client => client !== res);
  });
});

// Start Server
async function startServer() {
  await initDatabase();
  app.listen(PORT, () => {
    console.log(`🚀 Chatbot server running on http://localhost:${PORT}`);
    logEvent('SYSTEM', 'Server Boot', `WhatsApp state engine and CRM integration server initialized on port ${PORT}`, {});
  });
}

startServer();
