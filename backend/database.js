import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'whatsapp_bot.db');
const db = new sqlite3.Database(dbPath);

// Event emitter to notify server.js for SSE updates
export const dbEvents = new EventEmitter();

// Promisify DB methods
export const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

export const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

export const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// Initialize Tables
export async function initDatabase() {
  console.log('Initializing Database...');

  // Users Table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      phone_number TEXT UNIQUE NOT NULL,
      name TEXT,
      grade_segment TEXT,
      city TEXT,
      parent_phone TEXT,
      lead_stage TEXT DEFAULT 'New',
      lead_score INTEGER DEFAULT 0,
      acquisition_source TEXT DEFAULT 'organic',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // Sessions Table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_phone TEXT UNIQUE NOT NULL,
      current_workflow_id TEXT,
      current_node_id TEXT,
      game_state TEXT, -- JSON string
      variables TEXT,  -- JSON string
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // Behavioral Logs Table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS behavioral_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_phone TEXT NOT NULL,
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      payload TEXT, -- JSON string
      created_at TEXT NOT NULL
    )
  `);

  // Performance Data Table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS performance_data (
      id TEXT PRIMARY KEY,
      user_phone TEXT NOT NULL,
      level INTEGER NOT NULL,
      concept_tag TEXT NOT NULL,
      is_correct INTEGER NOT NULL, -- 0 or 1
      response_time_ms INTEGER NOT NULL,
      attempts INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  // User Tags Table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS user_tags (
      user_phone TEXT NOT NULL,
      tag TEXT NOT NULL,
      assigned_at TEXT NOT NULL,
      PRIMARY KEY (user_phone, tag)
    )
  `);

  console.log('Database Initialized Successfully.');
}

// ==========================================
// DB OPERATIONS / HELPERS
// ==========================================

export async function getOrCreateUser(phone) {
  const existing = await dbGet('SELECT * FROM users WHERE phone_number = ?', [phone]);
  if (existing) return existing;

  const now = new Date().toISOString();
  const userId = 'usr_' + Math.random().toString(36).substr(2, 9);
  await dbRun(
    `INSERT INTO users (id, phone_number, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    [userId, phone, now, now]
  );
  
  const created = await dbGet('SELECT * FROM users WHERE phone_number = ?', [phone]);
  await emitCrmUpdate(phone);
  return created;
}

export async function updateUser(phone, updates) {
  const fields = [];
  const params = [];
  for (const [key, val] of Object.entries(updates)) {
    fields.push(`${key} = ?`);
    params.push(val);
  }
  params.push(new Date().toISOString());
  params.push(phone);

  await dbRun(
    `UPDATE users SET ${fields.join(', ')}, updated_at = ? WHERE phone_number = ?`,
    params
  );
  
  const updated = await dbGet('SELECT * FROM users WHERE phone_number = ?', [phone]);
  await emitCrmUpdate(phone);
  return updated;
}

export async function getSession(phone) {
  const session = await dbGet('SELECT * FROM sessions WHERE user_phone = ?', [phone]);
  if (!session) return null;

  return {
    ...session,
    game_state: JSON.parse(session.game_state || '{}'),
    variables: JSON.parse(session.variables || '{}')
  };
}

export async function saveSession(phone, sessionData) {
  const existing = await getSession(phone);
  const now = new Date().toISOString();
  const gameStateStr = JSON.stringify(sessionData.game_state || {});
  const variablesStr = JSON.stringify(sessionData.variables || {});

  let savedSession;
  if (existing) {
    await dbRun(
      `UPDATE sessions SET current_workflow_id = ?, current_node_id = ?, game_state = ?, variables = ?, updated_at = ? WHERE user_phone = ?`,
      [
        sessionData.current_workflow_id || existing.current_workflow_id,
        sessionData.current_node_id || existing.current_node_id,
        gameStateStr,
        variablesStr,
        now,
        phone
      ]
    );
  } else {
    const sessionId = 'ses_' + Math.random().toString(36).substr(2, 9);
    await dbRun(
      `INSERT INTO sessions (id, user_phone, current_workflow_id, current_node_id, game_state, variables, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        phone,
        sessionData.current_workflow_id || 'default',
        sessionData.current_node_id || 'WELCOME',
        gameStateStr,
        variablesStr,
        now,
        now
      ]
    );
  }
  savedSession = await getSession(phone);
  dbEvents.emit('state_change', { phone, session: savedSession });
  return savedSession;
}

export async function logEvent(phone, eventType, title, description, payload = {}) {
  const now = new Date().toISOString();
  const payloadStr = JSON.stringify(payload);
  await dbRun(
    `INSERT INTO behavioral_logs (user_phone, event_type, title, description, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [phone, eventType, title, description, payloadStr, now]
  );
  
  dbEvents.emit('log', {
    id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    timestamp: now,
    category: eventType,
    title,
    description,
    payload
  });
}

export async function logPerformance(phone, level, conceptTag, isCorrect, responseTimeMs, attempts) {
  const id = 'perf_' + Math.random().toString(36).substr(2, 9);
  const now = new Date().toISOString();
  await dbRun(
    `INSERT INTO performance_data (id, user_phone, level, concept_tag, is_correct, response_time_ms, attempts, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, phone, level, conceptTag, isCorrect ? 1 : 0, responseTimeMs, attempts, now]
  );
  await emitCrmUpdate(phone);
}

export async function assignTag(phone, tag) {
  const now = new Date().toISOString();
  try {
    await dbRun(
      `INSERT INTO user_tags (user_phone, tag, assigned_at) VALUES (?, ?, ?)`,
      [phone, tag, now]
    );
    await logEvent(phone, 'TAG_ASSIGNED', 'Tag Assigned', `Assigned tag "${tag}"`, { tag });
    await emitCrmUpdate(phone);
  } catch (err) {
    // Tag already assigned (Unique PK constraint)
  }
}

export async function removeTag(phone, tag) {
  await dbRun(`DELETE FROM user_tags WHERE user_phone = ? AND tag = ?`, [phone, tag]);
  await logEvent(phone, 'TAG_REMOVED', 'Tag Removed', `Removed tag "${tag}"`, { tag });
  await emitCrmUpdate(phone);
}

export async function getTags(phone) {
  const rows = await dbAll('SELECT tag FROM user_tags WHERE user_phone = ?', [phone]);
  return rows.map(r => r.tag);
}

export async function getEnrichedContact(phone) {
  const user = await dbGet('SELECT * FROM users WHERE phone_number = ?', [phone]);
  if (!user) return null;
  const tags = await getTags(phone);
  const performances = await dbAll('SELECT * FROM performance_data WHERE user_phone = ?', [phone]);
  
  const correctCount = performances.filter(p => p.is_correct === 1).length;
  const avgResponseTime = performances.length > 0 
    ? Math.round(performances.reduce((acc, p) => acc + p.response_time_ms, 0) / performances.length) 
    : 0;

  return {
    ...user,
    whatsapp_number: user.phone_number, // map for frontend
    grade: user.grade_segment,
    phone: user.parent_phone,
    tags,
    score: correctCount,
    avg_response_time: avgResponseTime,
    performances
  };
}

async function emitCrmUpdate(phone) {
  const contact = await getEnrichedContact(phone);
  if (contact) {
    dbEvents.emit('crm_update', { contact });
  }
}

export async function getCRMContacts() {
  const users = await dbAll('SELECT * FROM users ORDER BY updated_at DESC');
  const enriched = [];
  for (const user of users) {
    const contact = await getEnrichedContact(user.phone_number);
    if (contact) enriched.push(contact);
  }
  return enriched;
}

export async function getBehavioralLogs() {
  const logs = await dbAll('SELECT * FROM behavioral_logs ORDER BY created_at DESC LIMIT 100');
  return logs.map(l => ({
    ...l,
    category: l.event_type, // Maintain compatibility with SSE event structure
    payload: JSON.parse(l.payload || '{}')
  }));
}

export async function resetDatabaseData() {
  await dbRun('DELETE FROM users');
  await dbRun('DELETE FROM sessions');
  await dbRun('DELETE FROM behavioral_logs');
  await dbRun('DELETE FROM performance_data');
  await dbRun('DELETE FROM user_tags');
  dbEvents.emit('reset');
  await logEvent('SYSTEM', 'SYSTEM_RESET', 'System Reset', 'All sessions, profiles, and performance data cleared.', {});
}
