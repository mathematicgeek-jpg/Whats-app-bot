/**
 * Gamified Vedic Math quiz engine.
 * Handles question generation, answer checking, and full gamification
 * (XP, levels, streaks, energy, ranks, badges, adaptive difficulty).
 */

import { query } from './db.js';
import { logger } from './logger.js';

// ============================================
// VEDIC MATH QUESTION BANK
// ============================================
const GAME_QUESTIONS = {
  1: {
    normal: {
      question: "Multiply 35 by 11. What is the answer? 🧠",
      answer: 385,
      trick: "Vedic trick: For any 2-digit number multiplied by 11, add the two digits (3 + 5 = 8) and place the sum in the middle to get 385! Easy as pie 🥧"
    },
    hard: {
      question: "🔥 Hard Challenge: Multiply 78 by 11. What is the answer? 🧠",
      answer: 858,
      trick: "Vedic trick: 7 + 8 = 15. Carry the 1 over to the 7 (7 + 1 = 8) and place 5 in the middle: 858!"
    }
  },
  2: {
    normal: {
      question: "Multiply 65 by 65 (65 squared). What is the answer? ⚡",
      answer: 4225,
      trick: "Vedic trick: For numbers ending in 5, multiply the tens digit by the next consecutive number (6 x 7 = 42) and write 25 at the end. Combined: 4225!"
    },
    hard: {
      question: "🔥 Hard Challenge: Multiply 95 by 95 (95 squared). What is the answer? ⚡",
      answer: 9025,
      trick: "Vedic trick: Multiply the tens digit by the next consecutive number (9 x 10 = 90) and write 25 at the end. Combined: 9025!"
    }
  },
  3: {
    normal: {
      question: "Multiply 96 by 97. What is the answer? (Base 100 subtraction method) 🎯",
      answer: 9312,
      trick: "Vedic trick: Both are close to 100. 96 is -4 below, 97 is -3 below. Cross-subtract: 96 - 3 = 93. Multiply deficiencies: 4 x 3 = 12. Combined: 9312! 🤯"
    },
    hard: {
      question: "🔥 Hard Challenge: Multiply 91 by 98. What is the answer? (Base 100 subtraction method) 🎯",
      answer: 8918,
      trick: "Vedic trick: 91 is -9 below, 98 is -2 below. Cross-subtract: 91 - 2 = 89. Multiply deficiencies: 9 x 2 = 18. Combined: 8918!"
    }
  },
  4: {
    normal: {
      question: "Multiply 103 by 105. What is the answer? (Base 100 addition method) 📈",
      answer: 10815,
      trick: "Vedic trick: Both are above 100. 103 is +3, 105 is +5. Cross-add: 103 + 5 = 108. Multiply surpluses: 3 x 5 = 15. Combined: 10815!"
    },
    hard: {
      question: "🔥 Hard Challenge: Multiply 107 by 108. What is the answer? (Base 100 addition method) 📈",
      answer: 11556,
      trick: "Vedic trick: 107 is +7, 108 is +8. Cross-add: 107 + 8 = 115. Multiply surpluses: 7 x 8 = 56. Combined: 11556!"
    }
  },
  5: {
    normal: {
      question: "Multiply 991 by 996. What is the answer? (Near 1000 method) 🏆",
      answer: 987036,
      trick: "Vedic trick: Base is 1000. Deficits are -9 and -4. Cross-subtract: 991 - 4 = 987. Multiply deficits: 9 x 4 = 36 (pad to 3 digits as 036). Combined: 987036!"
    },
    hard: {
      question: "🔥 Hard Challenge: Multiply 988 by 995. What is the answer? (Near 1000 method) 🏆",
      answer: 983060,
      trick: "Vedic trick: Base is 1000. Deficits are -12 and -5. Cross-subtract: 988 - 5 = 983. Multiply deficits: 12 x 5 = 60 (pad to 3 digits as 060). Combined: 983060!"
    }
  }
};

/**
 * Get a quiz question for the given level.
 * @param {number} level - 1-5
 * @param {boolean} isHardMode
 * @returns {{ question: string, level: number }}
 */
export function getQuestion(level, isHardMode = false) {
  const lvl = Math.min(Math.max(parseInt(level, 10) || 1, 1), 5);
  const data = GAME_QUESTIONS[lvl];
  const q = isHardMode ? data.hard : data.normal;
  return { level: lvl, question: q.question };
}

/**
 * Check the user's answer for a given level.
 * @param {number} level
 * @param {string} answer - user's raw answer text
 * @param {boolean} isHardMode
 * @returns {{ correct: boolean, trick: string, expectedAnswer: number }}
 */
export function checkAnswer(level, answer, isHardMode = false) {
  const lvl = Math.min(Math.max(parseInt(level, 10) || 1, 1), 5);
  const data = GAME_QUESTIONS[lvl];
  const q = isHardMode ? data.hard : data.normal;
  const parsed = parseInt(String(answer).replace(/[^\d-]/g, ''), 10);

  return {
    correct: parsed === q.answer,
    trick: q.trick,
    expectedAnswer: q.answer
  };
}

/**
 * Update gamification state (XP, level, streak, energy, badges, rank).
 * @param {string} phone
 * @param {boolean} isCorrect
 * @param {number} responseTimeMs
 * @returns {object} Updated gamification state
 */
export async function updateGamification(phone, isCorrect, responseTimeMs) {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  try {
    // 1. Fetch current user state
    const userRes = await query(
      'SELECT level, xp, streak, rank, badges, energy, last_active FROM users WHERE phone_number = $1',
      [phone]
    );

    let level = 1, xp = 0, streak = 0, rank = 'Bronze', badges = '[]', energy = 5, lastActive = null;

    if (userRes.rows.length > 0) {
      const row = userRes.rows[0];
      level = row.level || 1;
      xp = row.xp || 0;
      streak = row.streak || 0;
      rank = row.rank || 'Bronze';
      badges = row.badges || '[]';
      energy = row.energy === null ? 5 : row.energy;
      lastActive = row.last_active;
    } else {
      // Create user record if not exists
      await query(
        `INSERT INTO users (id, phone_number, level, xp, streak, rank, badges, energy, last_active, created_at, updated_at)
         VALUES ($1, $2, 1, 0, 0, 'Bronze', '[]', 5, NULL, $3, $4)`,
        ['usr_' + Math.random().toString(36).substr(2, 9), phone, now.toISOString(), now.toISOString()]
      );
    }

    let parsedBadges = [];
    try { parsedBadges = JSON.parse(badges); } catch { parsedBadges = []; }

    // 2. Streak logic
    if (!lastActive) {
      streak = 1;
    } else {
      const lastActiveDate = new Date(lastActive);
      const diffDays = Math.ceil(Math.abs(now - lastActiveDate) / (1000 * 60 * 60 * 24));
      if (lastActive === dateStr) {
        // Same day — retain streak
      } else if (diffDays === 1) {
        streak += 1;
      } else {
        streak = 1;
      }
    }

    // 3. XP & Energy calculation
    let xpGained = 0;
    if (isCorrect) {
      xpGained = 10;
      if (responseTimeMs < 5000) xpGained += 5; // speed bonus
      if (streak > 1) {
        xpGained = Math.floor(xpGained * (1 + streak * 0.1)); // streak multiplier
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

    const newEnergy = isCorrect
      ? Math.min(5, energy + 1)
      : Math.max(0, energy - 1);

    // 4. Persist to Postgres
    await query(
      `UPDATE users
       SET level = $1, xp = $2, streak = $3, rank = $4, badges = $5, energy = $6, last_active = $7, updated_at = $8
       WHERE phone_number = $9`,
      [newLevel, newXp, streak, rank, JSON.stringify(parsedBadges), newEnergy, dateStr, now.toISOString(), phone]
    );

    return { xpGained, levelUp, streak, xp: newXp, level: newLevel, rank, badges: parsedBadges, energy: newEnergy };
  } catch (err) {
    logger.error('Error in updateGamification', { error: err.message, phone });
    return { xpGained: 0, levelUp: false, streak: 1, xp: 0, level: 1, rank: 'Bronze', badges: [], energy: 5 };
  }
}

/**
 * Log quiz performance to Postgres.
 * @param {string} phone
 * @param {number} level
 * @param {boolean} isCorrect
 * @param {number} responseTimeMs
 * @param {number} attempts
 * @param {boolean} isHardMode
 */
export async function logPerformance(phone, level, isCorrect, responseTimeMs, attempts, isHardMode) {
  try {
    const id = 'perf_' + Math.random().toString(36).substr(2, 9);
    const conceptTag = `level_${level}_${isHardMode ? 'hard' : 'normal'}`;
    await query(
      `INSERT INTO performance_data (id, user_phone, level, concept_tag, is_correct, response_time_ms, attempts, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, phone, level, conceptTag, isCorrect ? 1 : 0, responseTimeMs, attempts, new Date().toISOString()]
    );
  } catch (err) {
    logger.error('Failed to log quiz performance', { error: err.message, phone, level });
  }
}

/**
 * Evaluate and assign segmentation tags based on user performance.
 * @param {string} phone
 */
export async function evaluateSegments(phone) {
  try {
    const userRes = await query('SELECT * FROM users WHERE phone_number = $1', [phone]);
    if (userRes.rows.length === 0) return;
    const user = userRes.rows[0];

    const perfRes = await query('SELECT * FROM performance_data WHERE user_phone = $1', [phone]);
    const performances = perfRes.rows;
    const totalPlayed = performances.length;
    const correctCount = performances.filter(p => p.is_correct === 1).length;
    const avgResponseTime = totalPlayed > 0
      ? performances.reduce((sum, p) => sum + p.response_time_ms, 0) / totalPlayed
      : null;
    const accuracyRate = totalPlayed > 0 ? (correctCount / totalPlayed) * 100 : 0;

    // Calculate derived attributes
    const fastLearnerScore = avgResponseTime && avgResponseTime > 0
      ? parseFloat((accuracyRate / (avgResponseTime / 1000)).toFixed(2))
      : 0;

    let churnRisk = 'LOW';
    const lastActiveStr = user.last_active;
    if (!lastActiveStr) {
      churnRisk = 'MEDIUM';
    } else {
      const diffDays = Math.ceil(Math.abs(new Date() - new Date(lastActiveStr)) / (1000 * 60 * 60 * 24));
      if (diffDays > 2 || user.streak === 0) churnRisk = 'HIGH';
    }

    const engagementScore = (user.streak || 0) * 10 + totalPlayed * 5 + (user.xp || 0) * 0.1;
    const difficultyPreference = (accuracyRate > 80 && avgResponseTime && avgResponseTime < 5000) ? 'hard' : 'normal';

    const derivedAttributes = { fast_learner_score: fastLearnerScore, churn_risk: churnRisk, engagement_score: engagementScore, difficulty_preference: difficultyPreference };

    // Store derived attributes
    await query(
      'UPDATE users SET derived_attributes = $1, updated_at = $2 WHERE phone_number = $3',
      [JSON.stringify(derivedAttributes), new Date().toISOString(), phone]
    );

    // Assign tags
    const now = new Date().toISOString();
    const tagsToAssign = [];

    if (accuracyRate >= 80 && totalPlayed >= 3) tagsToAssign.push('High Performer');
    if (accuracyRate < 40 && totalPlayed >= 3) tagsToAssign.push('Struggling Learner');
    if (avgResponseTime && avgResponseTime < 5000 && accuracyRate >= 60) tagsToAssign.push('Speed Demon');
    if ((user.streak || 0) >= 3) tagsToAssign.push('Streak Master');
    if (user.lead_stage === 'Qualified' || user.lead_stage === 'Demo Booked') tagsToAssign.push('Hot Lead');
    if (churnRisk === 'HIGH') tagsToAssign.push('At Risk');

    for (const tag of tagsToAssign) {
      await query(
        `INSERT INTO user_tags (user_phone, tag, assigned_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [phone, tag, now]
      );
    }

    // Remove contradictory tags
    if (accuracyRate >= 60) {
      await query('DELETE FROM user_tags WHERE user_phone = $1 AND tag = $2', [phone, 'Struggling Learner']);
    }
    if (accuracyRate < 60) {
      await query('DELETE FROM user_tags WHERE user_phone = $1 AND tag = $2', [phone, 'High Performer']);
    }
  } catch (err) {
    logger.error('Error evaluating segments', { error: err.message, phone });
  }
}
