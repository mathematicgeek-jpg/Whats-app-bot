import { startConsumer } from '@mathgeek/event-bus';
import { pgPool } from '@mathgeek/db';
import { logger } from '@mathgeek/utils';

// Start Analytics Consumers
async function start() {
  logger.info('Starting Analytics Service consumer...');

  // 1. Incoming Message Logs
  await startConsumer('analytics-incoming-group', 'whatsapp-incoming', async (event) => {
    const { user_id, timestamp, payload } = event;
    const desc = `From ${user_id}: "${payload.text.replace(/\n/g, ' ')}"`;
    await writeLog(user_id, 'WHATSAPP_IN', 'Message Received', desc, payload, timestamp);
  });

  // 2. Outgoing Message Logs
  await startConsumer('analytics-outgoing-group', 'whatsapp-outgoing-logs', async (event) => {
    const { user_id, timestamp, payload } = event;
    const desc = `To ${user_id}: "${payload.text.replace(/\n/g, ' ')}"`;
    await writeLog(user_id, 'WHATSAPP_OUT', 'Message Sent', desc, payload, timestamp);
  });

  // 3. Quiz Performance Logs
  await startConsumer('analytics-game-group', 'game-events', async (event) => {
    const { user_id, timestamp, payload } = event;
    const desc = payload.is_correct 
      ? `Level ${payload.level} Cleared (Attempts: ${payload.attempts}, Time: ${payload.response_time_ms}ms)`
      : `Level ${payload.level} Failed (Attempts: ${payload.attempts})`;
    await writeLog(user_id, 'GAME_EVENT', `Level ${payload.level} Answer`, desc, payload, timestamp);
  });

  // 4. Journey Node Transitions
  await startConsumer('analytics-journey-group', 'journey-events', async (event) => {
    const { user_id, timestamp, payload } = event;
    const desc = `Workflow node changed to "${payload.current_node_id}"`;
    
    // Sync state in session table
    await syncSessionState(user_id, payload.workflow_id, payload.current_node_id, payload.variables, timestamp);

    await writeLog(user_id, 'CRM_STATE', 'State Transitioned', desc, payload, timestamp);
  });

  // 5. Segment Tag Assignments
  await startConsumer('analytics-segment-group', 'segment-events', async (event) => {
    const { user_id, timestamp, payload } = event;
    const isAdded = !!payload.tag_added;
    const tag = isAdded ? payload.tag_added : payload.tag_removed;
    const desc = isAdded ? `Assigned tag "${tag}"` : `Removed tag "${tag}"`;
    await writeLog(user_id, isAdded ? 'TAG_ASSIGNED' : 'TAG_REMOVED', `Segment Updated`, desc, payload, timestamp);
  });
}

/**
 * Write log entry to PostgreSQL
 */
async function writeLog(phone, eventType, title, description, payload, timestamp) {
  if (phone === 'SYSTEM') return;
  
  try {
    await pgPool.query(
      `INSERT INTO behavioral_logs (user_phone, event_type, title, description, payload, created_at) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [phone, eventType, title, description, JSON.stringify(payload), timestamp]
    );
  } catch (err) {
    logger.error(`Failed to write behavioral log into Postgres: ${err.message}`);
  }
}

/**
 * Sync journey state in historical session table
 */
async function syncSessionState(phone, workflowId, nodeId, variables, timestamp) {
  try {
    await pgPool.query(
      `INSERT INTO sessions (id, user_phone, current_workflow_id, current_node_id, game_state, variables, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_phone) DO UPDATE SET 
         current_node_id = EXCLUDED.current_node_id,
         variables = EXCLUDED.variables,
         updated_at = EXCLUDED.updated_at`,
      ['ses_' + Math.random().toString(36).substr(2, 9), phone, workflowId, nodeId, '{}', JSON.stringify(variables), timestamp, timestamp]
    );
  } catch (err) {
    logger.error(`Failed to sync session row in PostgreSQL: ${err.message}`);
  }
}

start().catch(err => {
  logger.error(`Analytics Service consumer startup failure: ${err.message}`);
  process.exit(1);
});
