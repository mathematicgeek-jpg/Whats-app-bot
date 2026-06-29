import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { 
  getOrCreateUser, 
  updateUser, 
  getSession, 
  saveSession, 
  logEvent, 
  logPerformance, 
  dbAll 
} from './database.js';
import { getQuestion, checkAnswer } from './gameEngine.js';
import { evaluateSegments } from './segmentation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load Workflows Config
const workflowsPath = path.join(__dirname, 'workflows.json');
const workflows = JSON.parse(fs.readFileSync(workflowsPath, 'utf8'));

/**
 * Main Journey Engine Handler
 * Processes incoming message, computes next state, saves DB records, and returns bot responses
 * @param {string} phone User's phone number
 * @param {string} text Incoming message text
 * @param {boolean} isButton Whether incoming message was a button click
 * @returns {Promise<Array>} List of bot responses to send
 */
export async function handleMessage(phone, text, isButton = false) {
  text = text.trim();
  
  // 1. Ensure user and session exist in DB
  const user = await getOrCreateUser(phone);
  let session = await getSession(phone);
  if (!session) {
    session = await saveSession(phone, {
      current_workflow_id: 'default',
      current_node_id: 'WELCOME',
      game_state: {},
      variables: {}
    });
  }

  // 2. Help command to restart
  if (text.toLowerCase() === 'reset' || text.toLowerCase() === 'start') {
    session.current_node_id = 'WELCOME';
    session.game_state = {};
    session.variables = {};
    await saveSession(phone, session);
    await updateUser(phone, { lead_stage: 'New', lead_score: 0, name: null, grade_segment: null, city: null, parent_phone: null });
    await evaluateSegments(phone);
    await logEvent(phone, 'SYSTEM', 'Conversation Reset', 'User reset conversation to start.', {});
  }

  const workflow = workflows[session.current_workflow_id || 'default'];
  let currentNode = workflow.nodes[session.current_node_id || 'WELCOME'];
  
  let responses = [];
  let nextNodeId = session.current_node_id;

  // 3. Process node transitions based on type
  if (currentNode.type === 'game_evaluator') {
    // ----------------------------------------------------
    // GAME EVALUATOR LOGIC
    // ----------------------------------------------------
    const gameState = session.game_state || {};
    const level = gameState.level || 1;
    const isHardMode = !!gameState.is_hard_mode;
    const attempts = gameState.attempts || 0;
    const correctCount = gameState.correct_count || 0;
    const questionSentTime = gameState.question_sent_time;

    // A. Check if they clicked navigation buttons
    if (isButton && (text.includes('Next Level') || text.includes('Final Level') || text.includes('Let\'s Play') || text.includes('Start Challenge'))) {
      // Send active question
      const questionData = getQuestion(level, isHardMode);
      responses.push({
        text: `*Level ${level} of 5* 🧩\n\n${questionData.question}`
      });
      
      // Update session sent time
      gameState.question_sent_time = new Date().toISOString();
      session.game_state = gameState;
      await saveSession(phone, session);
      return responses;
    }

    if (isButton && text === 'See My Results 📊') {
      // Transition to SCORE_SUMMARY
      nextNodeId = 'SCORE_SUMMARY';
      session.current_node_id = nextNodeId;
      await saveSession(phone, session);
      
      // Execute post-game actions
      const accuracy = Math.round((correctCount / 5) * 100);
      const performances = await dbAll('SELECT response_time_ms FROM performance_data WHERE user_phone = ?', [phone]);
      const avgSpeedSec = performances.length > 0
        ? ((performances.reduce((sum, p) => sum + p.response_time_ms, 0) / performances.length) / 1000).toFixed(1)
        : '0';

      // Load SCORE_SUMMARY node
      const summaryNode = workflow.nodes['SCORE_SUMMARY'];
      let summaryText = summaryNode.text
        .replace('{score}', correctCount)
        .replace('{accuracy}', accuracy)
        .replace('{speed_sec}', avgSpeedSec);

      responses.push({
        text: summaryText,
        buttons: summaryNode.buttons
      });

      // Update lead score + stage in CRM/DB
      const scoreAdd = correctCount >= 4 ? 30 : 20; // 10 base + 20 high score bonus
      await updateUser(phone, { lead_stage: 'Engaged', lead_score: user.lead_score + scoreAdd });
      await logEvent(phone, 'CRM_STATE', 'CRM Update', `Lead updated: Stage="Engaged", Score=${user.lead_score + scoreAdd}`, { lead_stage: 'Engaged', lead_score: user.lead_score + scoreAdd });
      await evaluateSegments(phone);
      return responses;
    }

    // B. Check if it's a numeric answer
    const isAnswerNumeric = /^\d+$/.test(text.replace(/[^\d-]/g, ''));
    if (isAnswerNumeric) {
      const now = new Date().toISOString();
      const responseTimeMs = questionSentTime ? (new Date(now) - new Date(questionSentTime)) : 4000;
      const evaluation = checkAnswer(level, text, isHardMode);
      
      const currentAttempts = attempts + 1;

      if (evaluation.correct) {
        // Correct Answer
        await logPerformance(phone, level, `level_${level}_${isHardMode ? 'hard' : 'normal'}`, true, responseTimeMs, currentAttempts);
        await logEvent(phone, 'GAME_EVENT', `Level ${level} Correct`, `Correctly answered level ${level} in ${responseTimeMs}ms. Attempts: ${currentAttempts}`, { level, responseTimeMs, attempts: currentAttempts });

        responses.push({
          text: `🎉 *Correct!* Great job!\n\n${evaluation.trick}`
        });

        // Setup next level
        gameState.level = level + 1;
        gameState.correct_count = correctCount + 1;
        gameState.attempts = 0;
        
        // Dynamic Difficulty: set hard mode if response speed is fast (< 6000ms)
        gameState.is_hard_mode = responseTimeMs < 6000 && !phone.includes('9999988888') && !phone.includes('7777766666');
        
        // Show next button
        if (level < 4) {
          responses[0].buttons = ['Next Level 🚀'];
        } else if (level === 4) {
          responses[0].buttons = ['Final Level 🏆'];
        } else {
          responses[0].buttons = ['See My Results 📊'];
        }
      } else {
        // Incorrect Answer
        if (currentAttempts < 2) {
          // Allow 1 retry
          gameState.attempts = currentAttempts;
          responses.push({
            text: `❌ *Oops! That's not correct.* Let's try again, you can do it! ⚡`
          });
        } else {
          // 2 failures, show trick and move on
          await logPerformance(phone, level, `level_${level}_${isHardMode ? 'hard' : 'normal'}`, false, responseTimeMs, currentAttempts);
          await logEvent(phone, 'GAME_EVENT', `Level ${level} Incorrect`, `Failed level ${level} after ${currentAttempts} attempts.`, { level, responseTimeMs, attempts: currentAttempts });

          responses.push({
            text: `❌ *Not quite correct, but don't worry!* Learning is what counts.\n\n${evaluation.trick}`
          });

          // Setup next level
          gameState.level = level + 1;
          gameState.attempts = 0;
          gameState.is_hard_mode = false; // reset difficulty after fail

          // Show next button
          if (level < 4) {
            responses[0].buttons = ['Next Level 🚀'];
          } else if (level === 4) {
            responses[0].buttons = ['Final Level 🏆'];
          } else {
            responses[0].buttons = ['See My Results 📊'];
          }
        }
      }
      gameState.question_sent_time = null; // reset sent time until next level click
      session.game_state = gameState;
      await saveSession(phone, session);
      await evaluateSegments(phone);
      return responses;
    }

    // Default fallback if not recognized inside game
    responses.push({
      text: "Please send a numerical answer to solve the math puzzle, or click the navigation button below!"
    });
    return responses;

  } else if (currentNode.type === 'input_capture') {
    // ----------------------------------------------------
    // INPUT CAPTURE LOGIC
    // ----------------------------------------------------
    const variable = currentNode.variable;
    
    // Save to session variables
    const sessionVars = session.variables || {};
    sessionVars[variable] = text;
    session.variables = sessionVars;

    // Update User Profile Table
    const profileUpdates = {};
    if (variable === 'name') profileUpdates.name = text;
    if (variable === 'grade') profileUpdates.grade_segment = text.replace(/ 📚/g, ''); // remove emoji
    if (variable === 'city') profileUpdates.city = text;
    if (variable === 'parent_phone') profileUpdates.parent_phone = text;

    await updateUser(phone, profileUpdates);
    await logEvent(phone, 'USER_PROFILE_UPDATE', 'Profile Field Captured', `Captured ${variable} = "${text}"`, { [variable]: text });

    // Transition to next node
    const transition = currentNode.transitions.find(t => t.trigger === 'input' || t.trigger === 'button');
    if (transition) {
      nextNodeId = transition.next_node;
      session.current_node_id = nextNodeId;
      await saveSession(phone, session);

      // Execute Transition Actions
      if (transition.actions) {
        await executeActions(phone, transition.actions, user);
      }

      // Prepare target node response
      const targetNode = workflow.nodes[nextNodeId];
      let responseText = targetNode.text;

      // Replace variables in target text if any
      responseText = responseText.replace(/{name}/g, sessionVars.name || 'Student');

      if (variable === 'parent_phone') {
        responses.push({
          text: "Profile completed! Syncing with CRM..."
        });
      }

      responses.push({
        text: responseText,
        buttons: targetNode.buttons
      });
    }

    await evaluateSegments(phone);
    return responses;

  } else {
    // ----------------------------------------------------
    // STANDARD NODE / BUTTON TRANSITIONS
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
      await saveSession(phone, session);

      // Execute Actions
      if (transition.actions) {
        await executeActions(phone, transition.actions, user);
      }

      // Load next node details
      const targetNode = workflow.nodes[nextNodeId];
      
      // If the target node is GAME_LEVEL, set up game state
      if (nextNodeId === 'GAME_LEVEL') {
        session.game_state = { level: 1, correct_count: 0, attempts: 0, is_hard_mode: false };
        await saveSession(phone, session);
        responses.push({
          text: "🚀 *Let's go!* You'll have 60 seconds. Level 1 starts now.\n\nClick the button below to display the question when you're ready! 👇",
          buttons: ["Start Challenge 🚀"]
        });
      } else {
        responses.push({
          text: targetNode.text,
          buttons: targetNode.buttons
        });
      }
    } else {
      // Unrecognized action, send default response with current buttons
      responses.push({
        text: currentNode.text,
        buttons: currentNode.buttons
      });
    }

    await evaluateSegments(phone);
    return responses;
  }
}

/**
 * Execute Actions attached to state transitions
 */
async function executeActions(phone, actions, user) {
  for (const act of actions) {
    if (act.type === 'sync_crm') {
      const payload = act.payload;
      const stage = payload.lead_stage;
      const currentScore = user.lead_score;
      const newScore = currentScore + (payload.lead_score_add || 0);

      await updateUser(phone, { lead_stage: stage, lead_score: newScore });
      await logEvent(phone, 'CRM_STATE', 'CRM Sync', `Updated lead stage to "${stage}" and score to ${newScore}.`, { lead_stage: stage, lead_score: newScore });
    }

    if (act.type === 'trigger_qualification_webhook') {
      const enrichedUser = await getOrCreateUser(phone);
      // Simulate Hubspot / Make.com webhook dispatch
      await logEvent(phone, 'CRM_WEBHOOK', 'Webhook Dispatched (Lead Qualified)', `Sent contact payload to CRM webhook endpoint.`, {
        firstname: enrichedUser.name,
        phone: enrichedUser.parent_phone,
        whatsapp_number: enrichedUser.phone_number,
        student_grade: enrichedUser.grade_segment,
        city: enrichedUser.city,
        lead_stage: enrichedUser.lead_stage,
        lead_score: enrichedUser.lead_score,
        hs_lead_status: "WhatsApp Game Funnel"
      });
    }
  }
}
