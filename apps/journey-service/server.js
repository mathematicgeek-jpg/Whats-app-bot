import { startConsumer, publishEvent } from '@mathgeek/event-bus';
import { createEvent } from '@mathgeek/event-schema';
import { redis, pgPool } from '@mathgeek/db';
import { logger } from '@mathgeek/utils';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const workflows = JSON.parse(fs.readFileSync(path.join(__dirname, 'workflows.json'), 'utf8'));
const GAME_SERVICE_URL = process.env.GAME_SERVICE_URL || 'http://localhost:3002';

// Start Server & Listen to Event Bus
async function start() {
  logger.info('Starting Journey Service consumer...');

  // Consume Incoming Messages
  await startConsumer('journey-group', 'whatsapp-incoming', async (event) => {
    const { user_id, payload } = event;
    const { text, is_button } = payload;
    
    // System Reset Bypass
    if (user_id === 'SYSTEM' && text === 'reset') {
      await resetUserData();
      return;
    }

    await processJourneyTransition(user_id, text, is_button);
  });

  // Consume Journey Events (like Calendly mock booking)
  await startConsumer('journey-events-group', 'journey-events', async (event) => {
    const { user_id, payload } = event;
    const { current_node_id, variables } = payload;
    
    logger.info(`Received out-of-band journey step complete for ${user_id}: ${current_node_id}`);
    
    let session = await getRedisSession(user_id);
    if (session) {
      session.current_node_id = current_node_id;
      session.variables = { ...session.variables, ...variables };
      await saveRedisSession(user_id, session);
    }
  });
}

/**
 * Reset all data across Postgres & Redis (Simulated admin wipe)
 */
async function resetUserData() {
  logger.warn('SYSTEM RESET event received. Wiping databases...');
  
  // Redis clear
  const keys = await redis.keys('session:*');
  if (keys.length > 0) {
    await redis.del(keys);
  }

  // Postgres clear
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM user_tags');
    await client.query('DELETE FROM performance_data');
    await client.query('DELETE FROM sessions');
    await client.query('DELETE FROM users');
    await client.query('COMMIT');
    logger.info('Database tables cleared successfully.');
    
    // Emit reset event
    await publishEvent('platform-resets', createEvent('USER_MESSAGE_RECEIVED', 'SYSTEM', { text: 'reset_done', is_button: false }));
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(`Failed to wipe Postgres database during system reset: ${err.message}`);
  } finally {
    client.release();
  }
}

/**
 * Session getter from Redis
 */
async function getRedisSession(phone) {
  const data = await redis.get(`session:${phone}`);
  if (!data) return null;
  return JSON.parse(data);
}

/**
 * Session writer to Redis
 */
async function saveRedisSession(phone, session) {
  await redis.set(`session:${phone}`, JSON.stringify(session), 'EX', 86400 * 7); // 7 days TTL
}

/**
 * Core State Machine Loop
 */
async function processJourneyTransition(phone, text, isButton) {
  // Retrieve or initialize session state from Redis
  let session = await getRedisSession(phone);
  if (!session) {
    session = {
      phone,
      current_workflow_id: 'default',
      current_node_id: 'WELCOME',
      game_state: { level: 1, correct_count: 0, attempts: 0, is_hard_mode: false },
      variables: {}
    };
  }

  // Load active workflow configuration from PostgreSQL, fall back to workflows.json
  let workflow = null;
  try {
    const workflowId = session.current_workflow_id || 'default';
    const dbRes = await pgPool.query(
      'SELECT definition FROM journeys WHERE id = $1 AND is_active = true',
      [workflowId]
    );
    if (dbRes.rows.length > 0) {
      workflow = JSON.parse(dbRes.rows[0].definition);
    }
  } catch (err) {
    logger.error(`Failed to load active journey from DB: ${err.message}`);
  }

  // Fall back to workflows.json
  if (!workflow) {
    workflow = workflows[session.current_workflow_id || 'default'];
  }

  let currentNode = workflow.nodes[session.current_node_id || 'WELCOME'];
  
  let outboundMessages = [];
  let nextNodeId = session.current_node_id;

  if (currentNode.type === 'game_evaluator') {
    // ----------------------------------------------------
    // GAME STATE RESOLUTION
    // ----------------------------------------------------
    const gameState = session.game_state || {};
    const level = gameState.level || 1;
    const isHardMode = !!gameState.is_hard_mode;
    const attempts = gameState.attempts || 0;
    const correctCount = gameState.correct_count || 0;
    const questionSentTime = gameState.question_sent_time;

    // Check navigation button clicks
    if (isButton && (text.includes('Next Level') || text.includes('Final Level') || text.includes('Let\'s Play') || text.includes('Start Challenge'))) {
      // Get question from Game Service
      try {
        const gameRes = await fetch(`${GAME_SERVICE_URL}/api/game/question?level=${level}&isHardMode=${isHardMode}`);
        const qData = await gameRes.json();
        
        outboundMessages.push({
          text: `*Level ${level} of 5* 🧩\n\n${qData.question}`
        });

        gameState.question_sent_time = new Date().toISOString();
        session.game_state = gameState;
        await saveRedisSession(phone, session);
      } catch (err) {
        logger.error(`Failed to reach Game Service: ${err.message}`);
        outboundMessages.push({ text: "Sorry, the math engine is offline. Please try again in a moment!" });
      }
      
      await dispatchOutbound(phone, outboundMessages);
      return;
    }

    if (isButton && text === 'See My Results 📊') {
      nextNodeId = 'SCORE_SUMMARY';
      session.current_node_id = nextNodeId;
      await saveRedisSession(phone, session);

      const accuracy = Math.round((correctCount / 5) * 100);
      
      // Calculate avg response speed from Postgres
      let avgSpeedSec = '0';
      try {
        const res = await pgPool.query('SELECT response_time_ms FROM performance_data WHERE user_phone = $1', [phone]);
        if (res.rows.length > 0) {
          avgSpeedSec = ((res.rows.reduce((sum, r) => sum + r.response_time_ms, 0) / res.rows.length) / 1000).toFixed(1);
        }
      } catch (err) {
        logger.error(`Error querying performance database: ${err.message}`);
      }

      const summaryNode = workflow.nodes['SCORE_SUMMARY'];
      const summaryText = summaryNode.text
        .replace('{score}', correctCount)
        .replace('{accuracy}', accuracy)
        .replace('{speed_sec}', avgSpeedSec);

      outboundMessages.push({
        text: summaryText,
        buttons: summaryNode.buttons
      });

      // Update CRM stage to Engaged, increment lead score
      const scoreAdd = correctCount >= 4 ? 30 : 20;
      await updateCrmProfile(phone, 'Engaged', scoreAdd);

      // Emit Event
      await publishEvent('journey-events', createEvent('JOURNEY_STEP_COMPLETED', phone, {
        workflow_id: 'default',
        previous_node_id: 'GAME_LEVEL',
        current_node_id: 'SCORE_SUMMARY',
        variables: { score: correctCount, accuracy }
      }));

      await dispatchOutbound(phone, outboundMessages);
      return;
    }

    // Check answer submit
    const isAnswerNumeric = /^\d+$/.test(text.replace(/[^\d-]/g, ''));
    if (isAnswerNumeric) {
      const now = new Date().toISOString();
      const responseTimeMs = questionSentTime ? (new Date(now) - new Date(questionSentTime)) : 4000;
      const currentAttempts = attempts + 1;

      try {
        // Post check answer payload to Game Service
        const checkRes = await fetch(`${GAME_SERVICE_URL}/api/game/check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ level, answer: text, isHardMode })
        });
        const evalData = await checkRes.json();

        // Publish GAME_ANSWER_SUBMITTED event
        await publishEvent('game-events', createEvent('GAME_ANSWER_SUBMITTED', phone, {
          level,
          answer: text,
          is_correct: evalData.correct,
          response_time_ms: responseTimeMs,
          attempts: currentAttempts
        }));

        const gamRes = await updateGamification(phone, evalData.correct, responseTimeMs);
        const tagsRes = await pgPool.query('SELECT tag FROM user_tags WHERE user_phone = $1', [phone]);
        const userTags = tagsRes.rows.map(r => r.tag);
        const isStruggling = userTags.includes('Struggling Learner');

        let energyAlert = gamRes.energy === 0 ? "\n\n⚠️ *Out of Energy!* Restore ⚡ by finishing a review or playing tomorrow." : "";
        let levelUpAlert = gamRes.levelUp ? `🔥 *Level Up!* You reached *Level ${gamRes.level}* and unlocked *${gamRes.rank}* rank! 🏆\n\n` : "";

        if (evalData.correct) {
          outboundMessages.push({
            text: `${levelUpAlert}🎉 *Correct!* Great job! (+${gamRes.xpGained} XP, Streak: ${gamRes.streak} 🔥) | Level ${gamRes.level} (${gamRes.xp % 100}/100 XP)${energyAlert}\n\n${evalData.trick}`
          });

          gameState.level = level + 1;
          gameState.correct_count = correctCount + 1;
          gameState.attempts = 0;
          
          const uRes = await pgPool.query('SELECT derived_attributes FROM users WHERE phone_number = $1', [phone]);
          const derivedAttrs = uRes.rows[0]?.derived_attributes ? JSON.parse(uRes.rows[0].derived_attributes) : {};
          const isTestPhone = phone.includes('9999988888') || phone.includes('7777766666');
          gameState.is_hard_mode = !isTestPhone && (derivedAttrs.difficulty_preference === 'hard' || gamRes.level >= 3);

          if (level < 4) {
            outboundMessages[0].buttons = ['Next Level 🚀'];
          } else if (level === 4) {
            outboundMessages[0].buttons = ['Final Level 🏆'];
          } else {
            outboundMessages[0].buttons = ['See My Results 📊'];
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
            outboundMessages.push({
              text: `❌ *Oops! That's not correct.* Let's try again! (+2 XP for effort 🛡️) | Energy: ${gamRes.energy}/5 ⚡${hintText}${energyAlert}`
            });
          } else {
            // Fail after 2 retries, send trick and buttons to move on
            outboundMessages.push({
              text: `❌ *Not quite correct, but don't worry!* Learning is what counts. (+2 XP 🛡️) | Energy: ${gamRes.energy}/5 ⚡${energyAlert}\n\n${evalData.trick}`
            });

            gameState.level = level + 1;
            gameState.attempts = 0;
            gameState.is_hard_mode = false;

            if (level < 4) {
              outboundMessages[0].buttons = ['Next Level 🚀'];
            } else if (level === 4) {
              outboundMessages[0].buttons = ['Final Level 🏆'];
            } else {
              outboundMessages[0].buttons = ['See My Results 📊'];
            }
          }
        }
      } catch (err) {
        logger.error(`Error reaching Game Service for answer evaluation: ${err.message}`);
        outboundMessages.push({ text: "An error occurred in the math engine. Moving to next level..." });
        gameState.level = level + 1;
        gameState.attempts = 0;
        outboundMessages[0].buttons = level === 5 ? ['See My Results 📊'] : ['Next Level 🚀'];
      }

      gameState.question_sent_time = null;
      session.game_state = gameState;
      await saveRedisSession(phone, session);
      await dispatchOutbound(phone, outboundMessages);
      return;
    }

    outboundMessages.push({
      text: "Please send a numerical answer to solve the math puzzle, or click the navigation button below!"
    });
    await dispatchOutbound(phone, outboundMessages);
    return;

  } else if (currentNode.type === 'input_capture') {
    // ----------------------------------------------------
    // VARIABLE INPUT CAPTURE
    // ----------------------------------------------------
    const variable = currentNode.variable;
    session.variables[variable] = text;

    // Update Postgres user profile asynchronously/directly
    const fieldMapping = {
      name: 'name',
      grade: 'grade_segment',
      city: 'city',
      parent_phone: 'parent_phone'
    };

    const dbField = fieldMapping[variable];
    if (dbField) {
      try {
        const cleanVal = variable === 'grade' ? text.replace(/ 📚/g, '') : text;
        await pgPool.query(
          `INSERT INTO users (id, phone_number, ${dbField}, created_at, updated_at) 
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (phone_number) DO UPDATE SET ${dbField} = EXCLUDED.${dbField}, updated_at = EXCLUDED.updated_at`,
          ['usr_' + Math.random().toString(36).substr(2, 9), phone, cleanVal, new Date().toISOString(), new Date().toISOString()]
        );
      } catch (err) {
        logger.error(`Failed to update user profile in database: ${err.message}`);
      }
    }

    // Process transition
    const transition = currentNode.transitions.find(t => t.trigger === 'input' || t.trigger === 'button');
    if (transition) {
      nextNodeId = transition.next_node;
      session.current_node_id = nextNodeId;
      await saveRedisSession(phone, session);

      // Execute actions
      if (transition.actions) {
        await executeTransitionActions(phone, transition.actions);
      }

      const targetNode = workflow.nodes[nextNodeId];
      let responseText = targetNode.text.replace(/{name}/g, session.variables.name || 'Student');

      if (variable === 'parent_phone') {
        outboundMessages.push({
          text: "Profile completed! Syncing with CRM..."
        });
      }

      outboundMessages.push({
        text: responseText,
        buttons: targetNode.buttons
      });

      // Emit Journey step completed
      await publishEvent('journey-events', createEvent('JOURNEY_STEP_COMPLETED', phone, {
        workflow_id: 'default',
        previous_node_id: currentNode.node_id || session.current_node_id,
        current_node_id: nextNodeId,
        variables: session.variables
      }));
    }

    await saveRedisSession(phone, session);
    await dispatchOutbound(phone, outboundMessages);
    return;

  } else {
    // ----------------------------------------------------
    // STANDARD NAVIGATION NODES
    // ----------------------------------------------------
    const transition = currentNode.transitions.find(t => {
      if (t.trigger === 'button') {
        return text.toLowerCase() === t.value.toLowerCase();
      }
      return false;
    });

    if (transition) {
      nextNodeId = transition.next_node;
      session.current_node_id = nextNodeId;

      // Execute actions
      if (transition.actions) {
        await executeTransitionActions(phone, transition.actions);
      }

      const targetNode = workflow.nodes[nextNodeId];
      if (nextNodeId === 'GAME_LEVEL') {
        session.game_state = { level: 1, correct_count: 0, attempts: 0, is_hard_mode: false };
        outboundMessages.push({
          text: "🚀 *Let's go!* You'll have 60 seconds. Level 1 starts now.\n\nClick the button below to display the question when you're ready! 👇",
          buttons: ["Start Challenge 🚀"]
        });
      } else {
        outboundMessages.push({
          text: targetNode.text,
          buttons: targetNode.buttons
        });
      }

      await publishEvent('journey-events', createEvent('JOURNEY_STEP_COMPLETED', phone, {
        workflow_id: 'default',
        previous_node_id: currentNode.node_id || session.current_node_id,
        current_node_id: nextNodeId,
        variables: session.variables
      }));
    } else {
      // Fallback
      outboundMessages.push({
        text: currentNode.text,
        buttons: currentNode.buttons
      });
    }

    await saveRedisSession(phone, session);
    await dispatchOutbound(phone, outboundMessages);
    return;
  }
}

/**
 * Execute Actions attached to state transitions
 */
async function executeTransitionActions(phone, actions) {
  for (const act of actions) {
    if (act.type === 'sync_crm') {
      const payload = act.payload;
      await updateCrmProfile(phone, payload.lead_stage, payload.lead_score_add || 0);
    }
    if (act.type === 'trigger_qualification_webhook') {
      // Trigger side-effect
      await publishEvent('platform-resets', createEvent('USER_MESSAGE_RECEIVED', phone, { text: 'webhook_triggered', is_button: false }));
    }
  }
}

/**
 * Update gamification state (XP, level, streak, energy, badges) for a user in Postgres.
 */
async function updateGamification(phone, isCorrect, responseTimeMs) {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
  
  try {
    // 1. Fetch current status
    const userRes = await pgPool.query(
      'SELECT level, xp, streak, rank, badges, energy, last_active FROM users WHERE phone_number = $1',
      [phone]
    );
    
    let level = 1;
    let xp = 0;
    let streak = 0;
    let rank = 'Bronze';
    let badges = '[]';
    let energy = 5;
    let last_active = null;

    if (userRes.rows.length > 0) {
      const row = userRes.rows[0];
      level = row.level || 1;
      xp = row.xp || 0;
      streak = row.streak || 0;
      rank = row.rank || 'Bronze';
      badges = row.badges || '[]';
      energy = row.energy === null ? 5 : row.energy;
      last_active = row.last_active;
    } else {
      // Create user record if not exists
      await pgPool.query(
        `INSERT INTO users (id, phone_number, level, xp, streak, rank, badges, energy, last_active, created_at, updated_at)
         VALUES ($1, $2, 1, 0, 0, 'Bronze', '[]', 5, NULL, $3, $4)`,
        ['usr_' + Math.random().toString(36).substr(2, 9), phone, now.toISOString(), now.toISOString()]
      );
    }
    
    let parsedBadges = [];
    try {
      parsedBadges = JSON.parse(badges);
    } catch (e) {
      parsedBadges = [];
    }
    
    // 2. Streak calculations
    if (!last_active) {
      streak = 1;
    } else {
      const lastActiveDate = new Date(last_active);
      const diffTime = Math.abs(now - lastActiveDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      if (last_active === dateStr) {
        // Active today, retain streak
      } else if (diffDays === 1) {
        streak += 1;
      } else {
        streak = 1; // reset broken streak
      }
    }
    
    // 3. Calculate XP & Energy
    let xpGained = 0;
    if (isCorrect) {
      xpGained = 10;
      if (responseTimeMs < 5000) {
        xpGained += 5; // speed bonus
      }
      if (streak > 1) {
        const multiplier = 1 + (streak * 0.1);
        xpGained = Math.floor(xpGained * multiplier);
      }
    } else {
      xpGained = 2; // reward effort
    }
    
    const newXp = xp + xpGained;
    const newLevel = Math.floor(newXp / 100) + 1;
    let levelUp = false;
    
    if (newLevel > level) {
      levelUp = true;
      if (newLevel >= 5) rank = 'Diamond';
      else if (newLevel === 4) rank = 'Platinum';
      else if (newLevel === 3) rank = 'Gold';
      else if (newLevel === 2) rank = 'Silver';
      
      const newBadge = `Level ${newLevel} Solver`;
      if (!parsedBadges.includes(newBadge)) {
        parsedBadges.push(newBadge);
      }
    }
    
    let newEnergy = energy;
    if (!isCorrect) {
      newEnergy = Math.max(0, energy - 1);
    } else {
      newEnergy = Math.min(5, energy + 1);
    }
    
    await pgPool.query(
      `UPDATE users 
       SET level = $1, xp = $2, streak = $3, rank = $4, badges = $5, energy = $6, last_active = $7, updated_at = $8
       WHERE phone_number = $9`,
      [newLevel, newXp, streak, rank, JSON.stringify(parsedBadges), newEnergy, dateStr, now.toISOString(), phone]
    );
    
    return {
      xpGained,
      levelUp,
      streak,
      xp: newXp,
      level: newLevel,
      rank,
      badges: parsedBadges,
      energy: newEnergy
    };
  } catch (err) {
    logger.error(`Error in updateGamification: ${err.message}`);
    return { xpGained: 0, levelUp: false, streak: 1, xp: 0, level: 1, rank: 'Bronze', badges: [], energy: 5 };
  }
}

/**
 * Database update lead state helper
 */
async function updateCrmProfile(phone, stage, scoreAdd) {
  try {
    await pgPool.query(
      `INSERT INTO users (id, phone_number, lead_stage, lead_score, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (phone_number) DO UPDATE SET 
         lead_stage = EXCLUDED.lead_stage, 
         lead_score = users.lead_score + EXCLUDED.lead_score, 
         updated_at = EXCLUDED.updated_at`,
      ['usr_' + Math.random().toString(36).substr(2, 9), phone, stage, scoreAdd, new Date().toISOString(), new Date().toISOString()]
    );
  } catch (err) {
    logger.error(`Failed to sync CRM profile in PostgreSQL: ${err.message}`);
  }
}

/**
 * Emit outbound messages onto the notification event stream
 */
async function dispatchOutbound(phone, messages) {
  for (const msg of messages) {
    await publishEvent('outbound-notifications', {
      to: phone,
      text: msg.text,
      buttons: msg.buttons || []
    });
  }
}

start().catch(err => {
  logger.error(`Journey Service startup failure: ${err.message}`);
  process.exit(1);
});
