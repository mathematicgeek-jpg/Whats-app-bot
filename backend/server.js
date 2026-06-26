import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'MATH_GEEK_BOT_VERIFY_TOKEN';

app.use(cors());
app.use(express.json());

// ==========================================
// IN-MEMORY DATABASES (SIMULATING CRM & REDIS)
// ==========================================
let sessions = {}; // whatsappNumber -> sessionState
let contacts = {};  // whatsappNumber -> CRM Contact
let logs = [];      // Array of event objects (webhooks, alerts, state changes)
let sseClients = []; // Active SSE connections for real-time dashboard updates

// Reset Helper
function resetDatabase() {
  sessions = {};
  contacts = {};
  logs = [];
  broadcast('reset', { message: 'Database reset' });
  logEvent('SYSTEM', 'System Reset', 'All sessions and contacts cleared.', {});
}

// Log Event Helper
function logEvent(category, title, description, payload = {}) {
  const logEntry = {
    id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    timestamp: new Date().toISOString(),
    category, // 'WHATSAPP_IN' | 'WHATSAPP_OUT' | 'CRM_WEBHOOK' | 'CRM_STATE' | 'SALES_ALERT' | 'SYSTEM'
    title,
    description,
    payload
  };
  logs.unshift(logEntry);
  if (logs.length > 100) logs.pop();
  broadcast('log', logEntry);
}

// Broadcast SSE Helper
function broadcast(type, data) {
  sseClients.forEach(client => {
    client.write(`event: ${type}\n`);
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  });
}

// ==========================================
// VEDIC MATH GAME ENGINE SPECIFICATION
// ==========================================
const GAME_LEVELS = {
  1: {
    question: "Multiply 35 by 11. What is the answer? 🧠",
    answer: 385,
    trick: "Vedic trick: For any 2-digit number multiplied by 11, add the two digits (3 + 5 = 8) and place the sum in the middle to get 385! Easy as pie 🥧"
  },
  2: {
    question: "Multiply 65 by 65 (65 squared). What is the answer? ⚡",
    answer: 4225,
    trick: "Vedic trick: For numbers ending in 5, multiply the tens digit by the next consecutive number (6 x 7 = 42) and write 25 at the end. Combined: 4225!"
  },
  3: {
    question: "Multiply 96 by 97. What is the answer? (Base 100 subtraction method) 🎯",
    answer: 9312,
    trick: "Vedic trick: Both are close to 100. 96 is -4 below, 97 is -3 below. Cross-subtract: 96 - 3 = 93. Multiply deficiencies: 4 x 3 = 12. Combined: 9312! 🤯"
  },
  4: {
    question: "Multiply 103 by 105. What is the answer? (Base 100 addition method) 📈",
    answer: 10815,
    trick: "Vedic trick: Both are above 100. 103 is +3, 105 is +5. Cross-add: 103 + 5 = 108. Multiply surpluses: 3 x 5 = 15. Combined: 10815!"
  },
  5: {
    question: "Multiply 991 by 996. What is the answer? (Near 1000 method) 🏆",
    answer: 987036,
    trick: "Vedic trick: Base is 1000. Deficits are -9 and -4. Cross-subtract: 991 - 4 = 987. Multiply deficits: 9 x 4 = 36 (pad to 3 digits as 036). Combined: 987036!"
  }
};

// ==========================================
// STATE MACHINE LOGIC
// ==========================================
function processIncomingMessage(phone, text, isButton = false) {
  text = text.trim();
  
  // 1. Initialize session if new
  if (!sessions[phone]) {
    sessions[phone] = {
      phone,
      state: 'WELCOME', // WELCOME | INFO | GAME_LEVELS | SCORE_SUMMARY | CAPTURE_NAME | CAPTURE_GRADE | CAPTURE_CITY | CAPTURE_PHONE | PITCH_AND_CTA | COMPLETED
      score: 0,
      currentLevel: 1,
      name: null,
      grade: null,
      city: null,
      parentPhone: null,
      demoBooked: false,
      answers: {},
      retryCount: 0
    };
  }

  const session = sessions[phone];
  logEvent('WHATSAPP_IN', 'Message Received', `From ${phone}: "${text}" (State: ${session.state})`, { phone, text, isButton });

  // Help command to restart
  if (text.toLowerCase() === 'reset' || text.toLowerCase() === 'start') {
    session.state = 'WELCOME';
    session.score = 0;
    session.currentLevel = 1;
    session.answers = {};
    session.name = null;
    session.grade = null;
    session.city = null;
    session.parentPhone = null;
    session.demoBooked = false;
    session.retryCount = 0;
  }

  let responses = [];

  switch (session.state) {
    case 'WELCOME':
      if (isButton && text === 'Start Challenge 🚀') {
        session.state = 'GAME_LEVELS';
        session.currentLevel = 1;
        
        // Trigger CRM Lead Start
        syncContact(phone, { lead_stage: 'New', lead_score: 10 });
        logEvent('CRM_WEBHOOK', 'Lead Created', `Webhook sent to CRM: game_started for ${phone}`, getCRMContactPayload(phone));
        
        responses.push(getGameQuestion(1));
      } else if (isButton && text === 'Know More 📘') {
        session.state = 'INFO';
        responses.push({
          text: "📘 *Vedic Mathematics* is an ancient system that helps students solve math problems 10x faster with zero stress.\n\nOver 15,000+ students (Grades 3-12) have used our techniques to build math confidence!\n\nBest way to learn is by playing. Want to start the challenge? 👇",
          buttons: ["Let's Play! 🚀"]
        });
      } else {
        responses.push({
          text: "👋 Hey there! Welcome to *MathematicsGeek.com*!\n\nCan you solve equations faster than a calculator? Let's find out! 🧠⚡\n\nWe challenge you to a *60-Second Vedic Maths Game*. It has 5 levels, and we'll teach you a neat trick after each level. No pressure, just fun!\n\nAre you ready? 🚀",
          buttons: ["Start Challenge 🚀", "Know More 📘"]
        });
      }
      break;

    case 'INFO':
      if (isButton && (text === "Let's Play! 🚀" || text === "Start Challenge 🚀")) {
        session.state = 'GAME_LEVELS';
        session.currentLevel = 1;
        syncContact(phone, { lead_stage: 'New', lead_score: 10 });
        responses.push(getGameQuestion(1));
      } else {
        responses.push({
          text: "Let's check your speed! Tap below to start the game. 👇",
          buttons: ["Let's Play! 🚀"]
        });
      }
      break;

    case 'GAME_LEVELS':
      // Handle button navigation and skip/retry flows
      if (isButton || text === 'Next Level 🚀' || text === 'Final Level 🏆' || text === 'Skip Level ➡️' || text === 'Retry 🔄' || text === "Let's Play! 🚀" || text === "Play Math Game 🎮") {
        if (text === 'Next Level 🚀' || text === 'Final Level 🏆' || text === "Let's Play! 🚀" || text === "Play Math Game 🎮" || text === 'Retry 🔄') {
          responses.push(getGameQuestion(session.currentLevel));
          break;
        }
        if (text === 'Skip Level ➡️') {
          if (session.currentLevel < 5) {
            session.currentLevel += 1;
            session.retryCount = 0;
            responses.push(getGameQuestion(session.currentLevel));
          } else {
            session.state = 'SCORE_SUMMARY';
            responses.push({
              text: "Level 5 skipped. Let's check out your results! 📊",
              buttons: ["See My Results 📊"]
            });
          }
          break;
        }
      }

      const levelInfo = GAME_LEVELS[session.currentLevel];
      const parsedAns = parseInt(text.replace(/[^0-9]/g, ''), 10);

      if (isNaN(parsedAns)) {
        responses.push({
          text: "⚠️ *Whoops! Please enter a number containing only digits (e.g. 385).* Try answering again:",
          buttons: ["Skip Level ➡️"]
        });
        break;
      }

      session.answers[`l${session.currentLevel}`] = parsedAns;

      if (parsedAns === levelInfo.answer) {
        // Correct Answer
        session.score += 1;
        const correctPraise = ["Spot on! 🎉", "Fantastic! 🌟", "Incredible speed! 🚀", "Genius! 🔥", "Absolute Math Emperor! 👑"];
        const praise = correctPraise[session.currentLevel - 1];
        
        let explanationText = `${praise} *Correct!* ${levelInfo.answer}.\n\n💡 *${levelInfo.trick}*\n\nLet's move ahead!`;
        
        // Progress level
        if (session.currentLevel < 5) {
          session.currentLevel += 1;
          session.retryCount = 0;
          const nextBtnText = session.currentLevel === 5 ? "Final Level 🏆" : "Next Level 🚀";
          responses.push({
            text: explanationText,
            buttons: [nextBtnText]
          });
        } else {
          session.state = 'SCORE_SUMMARY';
          responses.push({
            text: explanationText,
            buttons: ["See My Results 📊"]
          });
        }
        
        // Update CRM Event & Score
        const partialScore = session.score;
        syncContact(phone, { 
          score: partialScore,
          lead_score: 10 + (session.currentLevel * 5)
        });
        logEvent('CRM_STATE', 'Level Completed', `Level ${session.currentLevel - 1} cleared by ${phone}. Game score: ${partialScore}/5`, { phone, level: session.currentLevel - 1, score: partialScore });

      } else {
        // Incorrect Answer
        session.retryCount += 1;
        let explanationText = `🧐 *Not quite!* Let's look at the shortcut:\n\n💡 *${levelInfo.trick}*\n\nWant to retry this level, or move to the next?`;
        
        if (session.currentLevel < 5) {
          responses.push({
            text: explanationText,
            buttons: ["Retry 🔄", "Skip Level ➡️"]
          });
        } else {
          session.state = 'SCORE_SUMMARY';
          responses.push({
            text: explanationText,
            buttons: ["See My Results 📊"]
          });
        }
      }
      break;

    case 'SCORE_SUMMARY':
      if (text === 'Retry 🔄') {
        session.state = 'GAME_LEVELS';
        responses.push(getGameQuestion(session.currentLevel));
      } else if (text === 'Skip Level ➡️') {
        if (session.currentLevel < 5) {
          session.currentLevel += 1;
          session.retryCount = 0;
          session.state = 'GAME_LEVELS';
          responses.push(getGameQuestion(session.currentLevel));
        } else {
          session.state = 'SCORE_SUMMARY';
          responses.push(getScoreSummaryMessage(session.score));
        }
      } else {
        // Shown score summary page
        session.state = 'CAPTURE_NAME';
        responses.push(getScoreSummaryMessage(session.score));
      }
      break;

    case 'CAPTURE_NAME':
      // User is either clicking "Unlock" or replying to name.
      if (isButton && (text === 'Unlock Advanced Tricks 🔓' || text === 'Book Free Live Class 📅')) {
        responses.push({
          text: "Excellent! First, what is the student's name? ✍️"
        });
      } else {
        // Text reply should be the name.
        if (text.length < 2 || /[0-9_!@#$%^&*(),.?":{}|<>]/.test(text)) {
          responses.push({
            text: "⚠️ *Please write a valid name (letters only, e.g. Rohan).* Let's try again:"
          });
        } else {
          session.name = text;
          session.state = 'CAPTURE_GRADE';
          responses.push({
            text: `Awesome to meet you, *${session.name}*! 👋\n\nWhat class/grade are you currently in? This helps us customize the Vedic Math tricks for your school level! 🎒`,
            buttons: ["Grade 3-5 🧸", "Grade 6-8 📚", "Grade 9-12 🎓"]
          });
        }
      }
      break;

    case 'CAPTURE_GRADE':
      const validGrades = ["Grade 3-5 🧸", "Grade 6-8 📚", "Grade 9-12 🎓", "Grade 3-5", "Grade 6-8", "Grade 9-12"];
      const matchingGrade = validGrades.find(g => text.toLowerCase().includes(g.replace(/[^\w\s-]/g, '').trim().toLowerCase()));
      
      if (!matchingGrade) {
        responses.push({
          text: "⚠️ *Please select your grade using the buttons below:*",
          buttons: ["Grade 3-5 🧸", "Grade 6-8 📚", "Grade 9-12 🎓"]
        });
      } else {
        // Clean grade mapping
        let gradeVal = "Grades 3-5";
        if (matchingGrade.includes("6-8")) gradeVal = "Grades 6-8";
        if (matchingGrade.includes("9-12")) gradeVal = "Grades 9-12";

        session.grade = gradeVal;
        session.state = 'CAPTURE_CITY';
        responses.push({
          text: `Perfect! Which city do you live in? 🏙️ *(Or click skip below)*`,
          buttons: ["Skip ➡️"]
        });
      }
      break;

    case 'CAPTURE_CITY':
      if (isButton && text === 'Skip ➡️') {
        session.city = "Not Disclosed";
      } else {
        session.city = text;
      }
      session.state = 'CAPTURE_PHONE';
      responses.push({
        text: `Last step, *${session.name}*! 📱\n\nTo send your Personalized Vedic Cheat Sheet PDF, please provide your parents' phone/WhatsApp number: *(Or click skip below)*`,
        buttons: ["Skip ➡️"]
      });
      break;

    case 'CAPTURE_PHONE':
      if (isButton && text === 'Skip ➡️') {
        session.parentPhone = "Not Disclosed";
      } else {
        const cleanedPhone = text.replace(/[^0-9+]/g, '');
        if (cleanedPhone.length < 10 || cleanedPhone.length > 15) {
          responses.push({
            text: "⚠️ *Please write a valid 10-15 digit phone number (e.g., +919876543210).* Or skip below:",
            buttons: ["Skip ➡️"]
          });
          break;
        }
        session.parentPhone = cleanedPhone;
      }

      // Profile Complete! Sync to CRM
      session.state = 'PITCH_AND_CTA';
      
      let baseLeadScore = 50; // game_completed + profile completed
      if (session.score >= 4) baseLeadScore += 10; // high score bonus

      syncContact(phone, {
        name: session.name,
        grade: session.grade,
        city: session.city,
        phone: session.parentPhone === "Not Disclosed" ? phone : session.parentPhone,
        lead_stage: 'Qualified',
        lead_score: baseLeadScore
      });

      // Send webhook notification
      logEvent('CRM_WEBHOOK', 'Lead Captured & Qualified', `Real-time webhook fired to CRM (HubSpot). Lead score: ${baseLeadScore}.`, getCRMContactPayload(phone));

      // Trigger High Score Slack Alert
      if (baseLeadScore >= 40) {
        triggerSlackAlert(phone);
      }

      // Add Pitch and Final CTA
      const pitchMsg = getGradeSegmentPitch(session.grade);
      responses.push({
        text: pitchMsg
      });

      responses.push({
        text: `🎁 *Exclusive Offer for ${session.name}!*\n\nWe are hosting a *Free 1-on-1 Live Vedic Maths Session* this week with our Senior Coach. We will identify your calculation roadblocks and teach 3 secret techniques!\n\nGrab a spot before they fill up! 📅`,
        buttons: ["Book Free Slot 📅", "Talk to Counselor 📞"]
      });
      break;

    case 'PITCH_AND_CTA':
      if (isButton && text === 'Book Free Slot 📅') {
        // Simulate Demo Link Click
        const newScore = Math.min(110, (contacts[phone]?.lead_score || 50) + 30);
        syncContact(phone, { lead_score: newScore });
        logEvent('CRM_STATE', 'Demo CTA Clicked', `User clicked demo link. Lead Score raised to ${newScore}.`, { phone });
        
        responses.push({
          text: `🔗 Redirecting you to Calendly... Click here to select your preferred date/time: *https://calendly.com/mathematicsgeek-free-demo*\n\nWe look forward to seeing you! 🌟`
        });
      } else if (isButton && text === 'Talk to Counselor 📞') {
        const newScore = Math.min(110, (contacts[phone]?.lead_score || 50) + 20);
        syncContact(phone, { lead_score: newScore });
        logEvent('SALES_ALERT', 'Counselor Callback Request', `User requested counselor callback. Priority Routing.`, { phone });
        
        responses.push({
          text: `📞 Got it! Our senior learning counselor will reach out to you on ${session.parentPhone === 'Not Disclosed' ? phone : session.parentPhone} within the next 2 hours. Keep your phone handy! 📱`
        });
      } else {
        responses.push({
          text: `Grab your free 1-on-1 Vedic Maths Session now! 👇`,
          buttons: ["Book Free Slot 📅", "Talk to Counselor 📞"]
        });
      }
      break;

    default:
      session.state = 'WELCOME';
      responses.push({
        text: "Let's restart! 👋 Can you calculate faster than a calculator? Let's check! 🧠⚡",
        buttons: ["Start Challenge 🚀"]
      });
  }

  // Push outgoing messages to simulator & log them
  responses.forEach(resp => {
    logEvent('WHATSAPP_OUT', 'Message Sent', `To ${phone}: "${resp.text.substring(0, 80)}${resp.text.length > 80 ? '...' : ''}"`, {
      to: phone,
      message_payload: getMetaMessagePayload(phone, resp)
    });
  });

  // Sync state to SSE clients
  broadcast('state_change', { phone, session: sessions[phone], contact: contacts[phone] });
  return responses;
}

// ==========================================
// UTILITY / GENERATOR HELPERS
// ==========================================

function getGameQuestion(level) {
  const levelData = GAME_LEVELS[level];
  return {
    text: `*Level ${level}/5* 🚀\n\n${levelData.question}\n\n_Type your answer as a number below:_`,
    buttons: level > 1 ? ["Skip Level ➡️"] : []
  };
}

function getScoreSummaryMessage(score) {
  const percentile = score >= 4 ? "Top 10%" : (score === 3 ? "Top 30%" : "Top 60%");
  const emoji = score >= 4 ? "👑" : "🥈";
  return {
    text: `📊 *Vedic Challenge Summary*\n\n• Score: *${score}/5 Correct*\n• Speed Rank: ${emoji} *${percentile} of Math Wizards!*\n\nYou've unlocked the basics! Want to learn how to do division, cube roots, and complex fractions in under 5 seconds? 🔓`,
    buttons: ["Unlock Advanced Tricks 🔓", "Book Free Live Class 📅"]
  };
}

function getGradeSegmentPitch(grade) {
  if (grade === "Grades 3-5") {
    return `🧸 *MathematicsGeek for Young Wizards (Grades 3-5)*\n\nAt this age, children either fall in love with numbers or develop math fear. Vedic Maths turns calculations into interactive shapes and mental patterns!\n\n📈 *Outcome:* 5x faster mental math, zero exam anxiety, and a lifelong love for maths!\n👥 *Social Proof:* 6,400+ primary kids trained worldwide!`;
  } else if (grade === "Grades 6-8") {
    return `📚 *MathematicsGeek Middle School Boost (Grades 6-8)*\n\nSchool syllabus is getting complex with fractions, algebra, and geometry. Vedic Math techniques help check long calculations in under 2 seconds!\n\n📈 *Outcome:* Cut calculation mistakes by 90%, finish math exams 20 mins early!\n👥 *Social Proof:* 9,200+ middle schoolers have aced their finals with us!`;
  } else {
    return `🎓 *MathematicsGeek Elite Prep (Grades 9-12 / SAT / ACT)*\n\nIn competitive exams, time is the ultimate filter. Vedic tricks allow you to bypass long calculations and spot answers instantly!\n\n📈 *Outcome:* Solve quadratic equations, square roots, and ratios in under 5 seconds!\n👥 *Social Proof:* Hundreds of students achieved perfect 800 scores on SAT Math!`;
  }
}

// CRM Sync Mock
function syncContact(phone, data) {
  if (!contacts[phone]) {
    contacts[phone] = {
      whatsapp_number: phone,
      name: 'Anonymous Wizard',
      phone: phone,
      grade: 'Not Selected',
      city: 'Not Selected',
      score: 0,
      lead_stage: 'New',
      lead_score: 0,
      source: 'WhatsApp Game Funnel',
      createdAt: new Date().toISOString()
    };
  }
  
  contacts[phone] = {
    ...contacts[phone],
    ...data
  };

  broadcast('crm_update', { contact: contacts[phone] });
}

// Generate CRM webhook Payload
function getCRMContactPayload(phone) {
  const contact = contacts[phone] || {};
  return {
    name: contact.name,
    phone: contact.phone,
    whatsapp_number: contact.whatsapp_number,
    grade: contact.grade,
    city: contact.city,
    score: contact.score,
    source: contact.source,
    lead_stage: contact.lead_stage,
    lead_score: contact.lead_score
  };
}

// Generate Meta Cloud API outgoing Message Payload
function getMetaMessagePayload(phone, response) {
  if (response.buttons && response.buttons.length > 0) {
    return {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
      type: "interactive",
      interactive: {
        type: "button",
        body: {
          text: response.text
        },
        action: {
          buttons: response.buttons.map((btn, idx) => ({
            type: "reply",
            reply: {
              id: `btn_${idx}`,
              title: btn.substring(0, 20) // Meta buttons limit is 20 chars
            }
          }))
        }
      }
    };
  } else {
    return {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
      type: "text",
      text: {
        body: response.text
      }
    };
  }
}

// Slack Alert Mock Trigger
function triggerSlackAlert(phone) {
  const contact = contacts[phone];
  const payload = {
    text: `🔥 *HOT LEAD ALERT: WhatsApp Vedic Maths Game* 🔥\n\n*Name:* ${contact.name}\n*Grade:* ${contact.grade}\n*City:* ${contact.city}\n*Game Score:* ${contact.score}/5\n*Lead Score:* ${contact.lead_score}\n*WhatsApp:* https://wa.me/${phone.replace(/[^0-9]/g, '')}\n\n*Action Required:* User completed profiling but hasn't booked a demo yet. Send follow-up!`,
    channel: "#sales-alerts",
    username: "Vedic Math Bot"
  };
  logEvent('SALES_ALERT', 'Slack Notification Dispatched', 'Notified #sales-alerts Slack Channel of Hot Lead', payload);
}

// Actual Meta Cloud API Outgoing Message Dispatcher
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
                title: btn.substring(0, 20) // Meta buttons limit is 20 chars
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
// EXPRESS HTTP ROUTING
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

// Webhook simulation / actual receiver (POST) - Supports Simulator and Meta API
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
      
      const botResponses = processIncomingMessage(phone, text, isButton);
      
      // Send actual responses back to user via Meta Cloud API if configured
      await sendMetaWhatsAppMessages(phone, botResponses);

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

  const botResponses = processIncomingMessage(phone, text, isButton);
  res.status(200).json({ success: true, responses: botResponses });
});

// Mock CRM API Endpoints
app.get('/api/crm/contacts', (req, res) => {
  res.json(Object.values(contacts));
});

app.get('/api/crm/logs', (req, res) => {
  res.json(logs);
});

// Calendly Mock Callback (Simulates user completing slot booking)
app.post('/api/crm/book-demo', (req, res) => {
  const { phone } = req.body;
  if (!phone || !contacts[phone]) {
    return res.status(400).json({ error: 'Valid contact phone required' });
  }

  // Update CRM
  syncContact(phone, {
    lead_stage: 'Demo Booked',
    lead_score: 110
  });

  // Log Webhook
  const payload = {
    event: "invitee.created",
    payload: {
      email: "parent@example.com",
      name: contacts[phone].name,
      phone: phone,
      tracking: {
        utm_source: "whatsapp_funnel"
      }
    }
  };
  logEvent('CRM_WEBHOOK', 'Calendly Invite Webhook Received', 'Webhook from Calendly matched contact and updated status.', payload);
  logEvent('CRM_STATE', 'Lead Stage Updated', `Lead stage for ${contacts[phone].name} changed to "Demo Booked"`, contacts[phone]);
  
  // Alert Slack
  const slackPayload = {
    text: `🎉 *NEW DEMO BOOKED* 🎉\n\n*Student:* ${contacts[phone].name}\n*Grade:* ${contacts[phone].grade}\n*Phone:* ${phone}\n*Score:* ${contacts[phone].score}/5\n*Pipeline Stage:* Demo Booked 📅`,
    channel: "#sales-alerts"
  };
  logEvent('SALES_ALERT', 'Slack Notification Dispatched', 'Notified #sales-alerts of demo class booking confirmation.', slackPayload);

  // Send Whatsapp Confirmation Message
  const session = sessions[phone];
  if (session) {
    session.state = 'COMPLETED';
    session.demoBooked = true;
    
    const confirmationText = `🎉 *Demo Confirmed, ${session.name}!* \n\nYour 1-on-1 session is scheduled. Our team will message you the Zoom link 15 minutes before the class.\n\nReady to unlock your math superpower? Let's do this! 💪`;
    
    logEvent('WHATSAPP_OUT', 'Message Sent', `To ${phone}: "Demo Confirmed..."`, {
      to: phone,
      message_payload: getMetaMessagePayload(phone, { text: confirmationText })
    });
    
    broadcast('state_change', { phone, session, contact: contacts[phone] });
  }

  res.json({ success: true, contact: contacts[phone] });
});

// Admin endpoint to trigger mock follow-up automation
app.post('/api/admin/trigger-followup', (req, res) => {
  const { phone, day } = req.body;
  if (!phone || !sessions[phone]) {
    return res.status(400).json({ error: 'Phone number does not have active session' });
  }

  const session = sessions[phone];
  let text = '';
  let buttons = [];

  if (day === 1) {
    text = `👋 Hey! We missed you yesterday!\nHere is a quick 2-second Vedic Trick: *Dividing by 9*.\n\nFor 23 ÷ 9:\n1. First digit *2* is the quotient.\n2. Add digits (2 + 3 = 5) -> this is the remainder.\nAnswer: *2 remainder 5*!\n\nWant to learn more shortcuts? Resume where you left off! 👇`;
    buttons = ["Resume Challenge 🚀", "Book Free Class 📅"];
  } else if (day === 2) {
    text = `"My daughter Aarohi used to cry during math homework. After just 3 classes of Vedic Maths, she calculates faster than me!" — Smita (Parent) 👩‍👧\n\nWatch Aarohi solve a 5-digit square root in 4 seconds: https://youtube.com/mock-video\n\nGive your child math confidence! 👇`;
    buttons = ["Book Free Class 📅", "Play Math Game 🎮"];
  } else if (day === 3) {
    text = `⏰ *Last Chance, ${session.name || 'Math Wizard'}!*\n\nThe free 1-on-1 Vedic Maths assessment slots are almost fully booked for this week. Only *3 spots* remain in your region.\n\nDon't miss this opportunity to triple your calculation speed! 👇`;
    buttons = ["Claim Free Spot Now 🎁"];
  } else {
    return res.status(400).json({ error: 'Invalid day. Must be 1, 2, or 3.' });
  }

  // Force session state to allow input from follow-up buttons
  if (day === 1 || day === 3) {
    session.state = 'PITCH_AND_CTA'; // redirecting back to conversion or game
  } else if (day === 2) {
    session.state = 'WELCOME';
  }

  logEvent('WHATSAPP_OUT', `Follow-up Sent (Day ${day})`, `Sent follow-up automation nudge to ${phone}`, { to: phone, text, buttons });
  broadcast('state_change', { phone, session, contact: contacts[phone] });

  res.json({ success: true, message: `Follow-up Day ${day} sent` });
});

// Admin Reset
app.post('/api/admin/reset', (req, res) => {
  resetDatabase();
  res.json({ success: true });
});

// SSE Connection Endpoint for Live Dashboard Sync
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.push(res);

  // Send initial data sync
  res.write(`event: init\n`);
  res.write(`data: ${JSON.stringify({
    contacts: Object.values(contacts),
    logs: logs,
    sessions: sessions
  })}\n\n`);

  req.on('close', () => {
    sseClients = sseClients.filter(client => client !== res);
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Chatbot server running on http://localhost:${PORT}`);
  logEvent('SYSTEM', 'Server Boot', `WhatsApp state engine and CRM integration server initialized on port ${PORT}`, {});
});
