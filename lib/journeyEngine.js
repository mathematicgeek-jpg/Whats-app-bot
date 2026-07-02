/**
 * Journey Engine — Core State Machine.
 * 
 * Processes user messages through configurable journey definitions.
 * Designed for stateless serverless invocation:
 *   1. Load session from Redis
 *   2. Load journey definition from Postgres (fallback: config/journeys.json)
 *   3. Process current node + user input
 *   4. Generate response messages
 *   5. Save updated session to Redis
 *   6. Return response messages
 *
 * Node types supported:
 *   - message: Send text and advance
 *   - input_capture: Store user input in variables
 *   - game_evaluator: Quiz game logic
 *   - condition: Evaluate expressions and branch
 *   - (future) api_call: External HTTP calls
 */

import { getSession, saveSession } from './stateManager.js';
import { query, bootstrapSchema } from './db.js';
import { getQuestion, checkAnswer, updateGamification, logPerformance, evaluateSegments } from './quizEngine.js';
import { sendTextMessage, sendButtonMessage } from './whatsappClient.js';
import { logger } from './logger.js';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

// Load default journey from config/journeys.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
let defaultJourneys = {};
try {
  const raw = readFileSync(join(__dirname, '..', 'config', 'journeys.json'), 'utf8');
  defaultJourneys = JSON.parse(raw);
} catch (err) {
  logger.warn('Could not load default journeys.json', { error: err.message });
}

/**
 * Process an incoming message through the journey engine.
 * This is the main entry point — called by webhook.js and simulate.js.
 * 
 * @param {object} parsed - Normalized message from parser.js
 *   { phone, text, type, isButton, messageId, timestamp }
 * @param {object} options - { sendMessages: boolean } 
 *   sendMessages=true for real WhatsApp, false for simulator (returns messages)
 * @returns {{ messages: Array<{text: string, buttons?: string[]}>, session: object }}
 */
export async function processMessage(parsed, options = { sendMessages: true }) {
  const { phone, text, isButton } = parsed;

  // Ensure DB schema exists
  await bootstrapSchema();

  // Load or initialize session
  let session = await getSession(phone);
  if (!session) {
    session = {
      phone,
      currentWorkflowId: 'default',
      currentNodeId: 'WELCOME',
      gameState: { level: 1, correctCount: 0, attempts: 0, isHardMode: false, questionSentTime: null },
      variables: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  // Load active journey from Postgres, fall back to journeys.json
  let workflow = null;
  try {
    const workflowId = session.currentWorkflowId || 'default';
    const dbRes = await query(
      'SELECT definition FROM journeys WHERE id = $1 AND is_active = true',
      [workflowId]
    );
    if (dbRes.rows.length > 0) {
      const def = dbRes.rows[0].definition;
      workflow = typeof def === 'string' ? JSON.parse(def) : def;
    }
  } catch (err) {
    logger.error('Failed to load journey from DB', { error: err.message });
  }

  if (!workflow) {
    workflow = defaultJourneys[session.currentWorkflowId || 'default'];
  }

  if (!workflow) {
    logger.error('No journey definition found', { workflowId: session.currentWorkflowId });
    return { messages: [{ text: "Sorry, something went wrong. Please try again later." }], session };
  }

  let outboundMessages = [];
  let evaluated = false;
  let loopCount = 0;

  while (!evaluated && loopCount < 5) {
    loopCount++;
    const node = workflow.nodes[session.currentNodeId || 'WELCOME'];
    
    if (!node) {
      logger.error('Current node not found in journey', { nodeId: session.currentNodeId });
      session.currentNodeId = 'WELCOME';
      const welcomeNode = workflow.nodes['WELCOME'];
      outboundMessages = [{ text: welcomeNode.text, buttons: welcomeNode.buttons }];
      evaluated = true;
      break;
    }

    // ================================================
    // A/B SPLIT NODE (Instant Evaluation)
    // ================================================
    if (node.type === 'ab_split') {
      const experimentName = node.experiment_name || session.currentNodeId;
      const lockKey = `ab_${experimentName}`;
      
      let nextNodeId = session.variables[lockKey];
      if (!nextNodeId) {
        let randomValue = Math.random() * 100;
        let accumulatedWeight = 0;
        let selectedVariant = node.variants[0].next_node;
        
        for (const variant of node.variants) {
          accumulatedWeight += variant.weight;
          if (randomValue <= accumulatedWeight) {
            selectedVariant = variant.next_node;
            break;
          }
        }
        nextNodeId = selectedVariant;
        session.variables[lockKey] = nextNodeId;
      }
      
      session.currentNodeId = nextNodeId;

      // Log event to A/B testing database table
      try {
        await query(
          `INSERT INTO ab_experiment_stats (experiment_name, variant_node_id, user_phone, converted, created_at)
           VALUES ($1, $2, $3, 0, $4) ON CONFLICT DO NOTHING`,
          [experimentName, nextNodeId, phone, new Date().toISOString()]
        );
      } catch (err) {
        logger.debug('Failed to log AB experiment assignment', { error: err.message });
      }

      // Continue state machine evaluation on the selected variant node immediately
      continue;
    }

    // ================================================
    // CONDITION NODE (Instant Evaluation)
    // ================================================
    if (node.type === 'condition') {
      const result = handleConditionNode(phone, text, session, workflow, node);
      outboundMessages = result.messages;
      session = result.session;
      // Continue execution on the next node instantly
      continue;
    }

    // ================================================
    // GAME EVALUATOR NODE
    // ================================================
    if (node.type === 'game_evaluator') {
      const result = await handleGameNode(phone, text, isButton, session, workflow);
      outboundMessages = result.messages;
      session = result.session;
      evaluated = true;
    }
    // ================================================
    // INPUT CAPTURE NODE
    // ================================================
    else if (node.type === 'input_capture') {
      const result = await handleInputCaptureNode(phone, text, isButton, session, workflow, node);
      outboundMessages = result.messages;
      session = result.session;
      evaluated = true;
    }
    // ================================================
    // META MESSAGE TEMPLATE NODE
    // ================================================
    else if (node.type === 'meta_template') {
      const result = await handleMetaTemplateNode(phone, text, isButton, session, workflow, node);
      outboundMessages = result.messages;
      session = result.session;
      evaluated = true;
    }
    // ================================================
    // STANDARD NAVIGATION NODE
    // ================================================
    else {
      const result = await handleNavigationNode(phone, text, isButton, session, workflow, node);
      outboundMessages = result.messages;
      session = result.session;
      evaluated = true;
    }
  }

  // Save updated session
  await saveSession(phone, session);

  // Send messages via WhatsApp API if in production mode
  if (options.sendMessages) {
    for (const msg of outboundMessages) {
      if (msg.buttons && msg.buttons.length > 0) {
        await sendButtonMessage(phone, msg.text, msg.buttons);
      } else {
        await sendTextMessage(phone, msg.text);
      }
    }
  }

  // Log behavioral event
  try {
    await query(
      `INSERT INTO behavioral_logs (user_phone, event_type, title, description, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [phone, 'JOURNEY_STEP', `Node: ${session.currentNodeId}`, `Processed message: "${text}"`,
       JSON.stringify({ nodeId: session.currentNodeId, text, isButton }), new Date().toISOString()]
    );
  } catch (err) {
    logger.debug('Failed to log behavioral event', { error: err.message });
  }

  return { messages: outboundMessages, session };
}


// ============================================
// GAME NODE HANDLER
// ============================================
async function handleGameNode(phone, text, isButton, session, workflow) {
  const gameState = session.gameState || {};
  const level = gameState.level || 1;
  const isHardMode = !!gameState.isHardMode;
  const attempts = gameState.attempts || 0;
  const correctCount = gameState.correctCount || 0;
  const questionSentTime = gameState.questionSentTime;
  const messages = [];

  // Navigation button clicks — send next question
  if (isButton && (
    text.includes('Next Level') ||
    text.includes('Final Level') ||
    text.includes("Let's Play") ||
    text.includes('Start Challenge')
  )) {
    const qData = getQuestion(level, isHardMode);
    messages.push({ text: `*Level ${level} of 5* 🧩\n\n${qData.question}` });
    gameState.questionSentTime = new Date().toISOString();
    session.gameState = gameState;
    return { messages, session };
  }

  // "See My Results" button
  if (isButton && text === 'See My Results 📊') {
    session.currentNodeId = 'SCORE_SUMMARY';
    const accuracy = Math.round((correctCount / 5) * 100);

    // Calculate avg response speed
    let avgSpeedSec = '0';
    try {
      const res = await query('SELECT response_time_ms FROM performance_data WHERE user_phone = $1', [phone]);
      if (res.rows.length > 0) {
        avgSpeedSec = ((res.rows.reduce((sum, r) => sum + r.response_time_ms, 0) / res.rows.length) / 1000).toFixed(1);
      }
    } catch (err) {
      logger.error('Error querying performance data', { error: err.message });
    }

    const summaryNode = workflow.nodes['SCORE_SUMMARY'];
    const summaryText = summaryNode.text
      .replace('{score}', correctCount)
      .replace('{accuracy}', accuracy)
      .replace('{speed_sec}', avgSpeedSec);

    messages.push({ text: summaryText, buttons: summaryNode.buttons });

    // Update CRM
    const scoreAdd = correctCount >= 4 ? 30 : 20;
    await updateCrmProfile(phone, 'Engaged', scoreAdd);

    return { messages, session };
  }

  // Answer submission
  const isAnswerNumeric = /^\d+$/.test(text.replace(/[^\d-]/g, ''));
  if (isAnswerNumeric) {
    const now = new Date().toISOString();
    const responseTimeMs = questionSentTime ? (new Date(now) - new Date(questionSentTime)) : 4000;
    const currentAttempts = attempts + 1;

    const evalData = checkAnswer(level, text, isHardMode);

    // Log performance
    await logPerformance(phone, level, evalData.correct, responseTimeMs, currentAttempts, isHardMode);

    // Update gamification
    const gamRes = await updateGamification(phone, evalData.correct, responseTimeMs);

    // Evaluate segments asynchronously
    evaluateSegments(phone).catch(err => logger.debug('Segment eval error', { error: err.message }));

    // Check for struggle hints
    const tagsRes = await query('SELECT tag FROM user_tags WHERE user_phone = $1', [phone]);
    const userTags = tagsRes.rows.map(r => r.tag);
    const isStruggling = userTags.includes('Struggling Learner');

    let energyAlert = gamRes.energy === 0 ? "\n\n⚠️ *Out of Energy!* Restore ⚡ by finishing a review or playing tomorrow." : "";
    let levelUpAlert = gamRes.levelUp ? `🔥 *Level Up!* You reached *Level ${gamRes.level}* and unlocked *${gamRes.rank}* rank! 🏆\n\n` : "";

    if (evalData.correct) {
      messages.push({
        text: `${levelUpAlert}🎉 *Correct!* Great job! (+${gamRes.xpGained} XP, Streak: ${gamRes.streak} 🔥) | Level ${gamRes.level} (${gamRes.xp % 100}/100 XP)${energyAlert}\n\n${evalData.trick}`
      });

      gameState.level = level + 1;
      gameState.correctCount = correctCount + 1;
      gameState.attempts = 0;

      // Adaptive difficulty
      const uRes = await query('SELECT derived_attributes FROM users WHERE phone_number = $1', [phone]);
      const derivedAttrs = uRes.rows[0]?.derived_attributes ? JSON.parse(uRes.rows[0].derived_attributes) : {};
      gameState.isHardMode = derivedAttrs.difficulty_preference === 'hard' || gamRes.level >= 3;

      if (level < 4) {
        messages[0].buttons = ['Next Level 🚀'];
      } else if (level === 4) {
        messages[0].buttons = ['Final Level 🏆'];
      } else {
        messages[0].buttons = ['See My Results 📊'];
      }
    } else {
      let hintText = "";
      if (isStruggling) {
        if (level === 1) hintText = "\n\n💡 *Hint*: For multiplying by 11, add the two digits of the number and insert in the middle!";
        if (level === 2) hintText = "\n\n💡 *Hint*: For squaring numbers ending in 5, multiply the tens digit by (tens + 1) and append 25!";
        if (level === 3) hintText = "\n\n💡 *Hint*: Base 100 subtraction: check how far below 100 each number is!";
      }

      if (currentAttempts < 2) {
        gameState.attempts = currentAttempts;
        messages.push({
          text: `❌ *Oops! That's not correct.* Let's try again! (+2 XP for effort 🛡️) | Energy: ${gamRes.energy}/5 ⚡${hintText}${energyAlert}`
        });
      } else {
        messages.push({
          text: `❌ *Not quite correct, but don't worry!* Learning is what counts. (+2 XP 🛡️) | Energy: ${gamRes.energy}/5 ⚡${energyAlert}\n\n${evalData.trick}`
        });

        gameState.level = level + 1;
        gameState.attempts = 0;
        gameState.isHardMode = false;

        if (level < 4) {
          messages[0].buttons = ['Next Level 🚀'];
        } else if (level === 4) {
          messages[0].buttons = ['Final Level 🏆'];
        } else {
          messages[0].buttons = ['See My Results 📊'];
        }
      }
    }

    gameState.questionSentTime = null;
    session.gameState = gameState;
    return { messages, session };
  }

  // Fallback — not a number
  messages.push({ text: "Please send a numerical answer to solve the math puzzle, or click the navigation button below!" });
  return { messages, session };
}


// ============================================
// INPUT CAPTURE NODE HANDLER
// ============================================
async function handleInputCaptureNode(phone, text, isButton, session, workflow, currentNode) {
  const variable = currentNode.variable;
  session.variables[variable] = text;
  const messages = [];

  // Persist to user profile
  const fieldMapping = { name: 'name', grade: 'grade_segment', city: 'city', parent_phone: 'parent_phone' };
  const dbField = fieldMapping[variable];
  if (dbField) {
    try {
      const cleanVal = variable === 'grade' ? text.replace(/ 📚/g, '') : text;
      await query(
        `INSERT INTO users (id, phone_number, ${dbField}, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (phone_number) DO UPDATE SET ${dbField} = EXCLUDED.${dbField}, updated_at = EXCLUDED.updated_at`,
        ['usr_' + Math.random().toString(36).substr(2, 9), phone, cleanVal, new Date().toISOString(), new Date().toISOString()]
      );
    } catch (err) {
      logger.error('Failed to update user profile', { error: err.message, phone });
    }
  }

  // Process transition
  const transition = currentNode.transitions.find(t => t.trigger === 'input' || t.trigger === 'button');
  if (transition) {
    session.currentNodeId = transition.next_node;

    if (transition.actions) {
      await executeActions(phone, transition.actions);
    }

    const targetNode = workflow.nodes[transition.next_node];
    let responseText = targetNode.text.replace(/{name}/g, session.variables.name || 'Student');

    if (variable === 'parent_phone') {
      messages.push({ text: "Profile completed! Syncing with CRM..." });
    }

    messages.push({ text: responseText, buttons: targetNode.buttons });
  }

  return { messages, session };
}


// ============================================
// CONDITION NODE HANDLER
// ============================================
function handleConditionNode(phone, text, session, workflow, currentNode) {
  const messages = [];

  // Evaluate condition against session variables
  let nextNodeId = currentNode.fallback || 'WELCOME';
  for (const branch of (currentNode.branches || [])) {
    if (evaluateCondition(branch.condition, session)) {
      nextNodeId = branch.next_node;
      break;
    }
  }

  session.currentNodeId = nextNodeId;
  const targetNode = workflow.nodes[nextNodeId];
  if (targetNode) {
    let responseText = targetNode.text.replace(/{name}/g, session.variables.name || 'Student');
    messages.push({ text: responseText, buttons: targetNode.buttons });
  }

  return { messages, session };
}

/**
 * Simple expression evaluator for condition nodes.
 * Supports: variable > number, variable == value, variable != value
 */
function evaluateCondition(conditionStr, session) {
  if (!conditionStr) return false;

  const vars = { ...session.variables, ...session.gameState };
  const cleanExpr = conditionStr.trim();

  // Match patterns like "score > 5", "name == John", "level != 3"
  const match = cleanExpr.match(/^(\w+)\s*(==|!=|>|<|>=|<=)\s*(.+)$/);
  if (!match) return false;

  const [, key, operator, rawValue] = match;
  const left = vars[key];
  const right = isNaN(rawValue) ? rawValue.replace(/['"]/g, '') : Number(rawValue);
  const leftNum = Number(left);
  const rightNum = Number(right);

  switch (operator) {
    case '==': return String(left) === String(right);
    case '!=': return String(left) !== String(right);
    case '>':  return leftNum > rightNum;
    case '<':  return leftNum < rightNum;
    case '>=': return leftNum >= rightNum;
    case '<=': return leftNum <= rightNum;
    default: return false;
  }
}


// ============================================
// STANDARD NAVIGATION NODE HANDLER
// ============================================
async function handleNavigationNode(phone, text, isButton, session, workflow, currentNode) {
  const messages = [];

  const transition = currentNode.transitions.find(t => {
    if (t.trigger === 'button') {
      return text.toLowerCase() === t.value.toLowerCase();
    }
    return false;
  });

  if (transition) {
    session.currentNodeId = transition.next_node;

    if (transition.actions) {
      await executeActions(phone, transition.actions);
    }

    const targetNode = workflow.nodes[transition.next_node];
    if (session.currentNodeId === 'GAME_LEVEL') {
      session.gameState = { level: 1, correctCount: 0, attempts: 0, isHardMode: false, questionSentTime: null };
      messages.push({
        text: "🚀 *Let's go!* You'll have 60 seconds. Level 1 starts now.\n\nClick the button below to display the question when you're ready! 👇",
        buttons: ["Start Challenge 🚀"]
      });
    } else {
      messages.push({ text: targetNode.text, buttons: targetNode.buttons });
    }
  } else {
    // Fallback — resend current node
    messages.push({ text: currentNode.text, buttons: currentNode.buttons });
  }

  return { messages, session };
}


// ============================================
// ACTION EXECUTORS
// ============================================
async function executeActions(phone, actions) {
  for (const act of actions) {
    if (act.type === 'sync_crm') {
      await updateCrmProfile(phone, act.payload.lead_stage, act.payload.lead_score_add || 0);
    }
  }
}

async function updateCrmProfile(phone, stage, scoreAdd) {
  try {
    await query(
      `INSERT INTO users (id, phone_number, lead_stage, lead_score, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (phone_number) DO UPDATE SET
         lead_stage = EXCLUDED.lead_stage,
         lead_score = users.lead_score + EXCLUDED.lead_score,
         updated_at = EXCLUDED.updated_at`,
      ['usr_' + Math.random().toString(36).substr(2, 9), phone, stage, scoreAdd, new Date().toISOString(), new Date().toISOString()]
    );

    // Update AB testing stats if converted
    if (stage === 'Qualified' || stage === 'Demo Booked') {
      try {
        await query(
          `UPDATE ab_experiment_stats SET converted = 1 WHERE user_phone = $1`,
          [phone]
        );
      } catch (err) {
        logger.debug('Failed to update AB experiment conversion', { error: err.message });
      }
    }
  } catch (err) {
    logger.error('Failed to sync CRM profile', { error: err.message, phone });
  }
}

// ============================================
// META TEMPLATE NODE HANDLER
// ============================================
async function handleMetaTemplateNode(phone, text, isButton, session, workflow, currentNode) {
  const messages = [];

  const transition = currentNode.transitions.find(t => {
    if (t.trigger === 'button') {
      return text.toLowerCase() === t.value.toLowerCase();
    }
    return false;
  });

  if (transition) {
    session.currentNodeId = transition.next_node;

    if (transition.actions) {
      await executeActions(phone, transition.actions);
    }

    const targetNode = workflow.nodes[transition.next_node];
    if (session.currentNodeId === 'GAME_LEVEL') {
      session.gameState = { level: 1, correctCount: 0, attempts: 0, isHardMode: false, questionSentTime: null };
      messages.push({
        text: "🚀 *Let's go!* You'll have 60 seconds. Level 1 starts now.\n\nClick the button below to display the question when you're ready! 👇",
        buttons: ["Start Challenge 🚀"]
      });
    } else {
      messages.push({ text: targetNode.text, buttons: targetNode.buttons });
    }
  } else {
    // Entering node: format and send template body
    let body = currentNode.text || `[Template: ${currentNode.template_name}]`;
    if (currentNode.parameters && currentNode.parameters.body) {
      currentNode.parameters.body.forEach((param, index) => {
        body = body.replace(`{{${index + 1}}}`, param.text);
      });
    }
    
    const buttons = (currentNode.buttons || []).map(b => typeof b === 'string' ? b : b.text);
    messages.push({ text: body, buttons: buttons });
  }

  return { messages, session };
}
