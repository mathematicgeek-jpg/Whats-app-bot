import { getTags, assignTag, removeTag, dbAll, getOrCreateUser, logEvent, updateUser } from './database.js';

/**
 * Re-evaluates user segments (tags) based on their profiles, performance, and behavior.
 * This runs after game sessions, profile updates, and trigger events.
 * @param {string} phone The user's WhatsApp phone number
 */
export async function evaluateSegments(phone) {
  const user = await getOrCreateUser(phone);
  const currentTags = await getTags(phone);

  // 1. Fetch Performance metrics
  const performances = await dbAll('SELECT * FROM performance_data WHERE user_phone = ?', [phone]);
  const correctCount = performances.filter(p => p.is_correct === 1).length;
  const attemptsCount = performances.reduce((sum, p) => sum + p.attempts, 0);
  const avgResponseTime = performances.length > 0
    ? performances.reduce((sum, p) => sum + p.response_time_ms, 0) / performances.length
    : null;

  const totalLevelsPlayed = performances.length;
  const accuracyRate = totalLevelsPlayed > 0 ? (correctCount / totalLevelsPlayed) * 100 : 0;

  // Track tags to assign and remove
  const tagsToAssign = [];
  const tagsToRemove = [];

  // RULE 1: Math Wizard (Score = 5 and Average Response Time < 6000ms)
  if (totalLevelsPlayed === 5 && correctCount === 5 && avgResponseTime && avgResponseTime < 6000) {
    tagsToAssign.push('Math Wizard');
  } else {
    tagsToRemove.push('Math Wizard');
  }

  // RULE 2: Struggling Learner (Accuracy < 60% after completing at least 3 levels)
  if (totalLevelsPlayed >= 3 && accuracyRate < 60) {
    tagsToAssign.push('Struggling Learner');
  } else {
    tagsToRemove.push('Struggling Learner');
  }

  // RULE 3: Speed Demon (Average Response Time < 4500ms regardless of score)
  if (totalLevelsPlayed >= 3 && avgResponseTime && avgResponseTime < 4500) {
    tagsToAssign.push('Speed Demon');
  } else {
    tagsToRemove.push('Speed Demon');
  }

  // RULE 4: High Intent Lead (Lead Score >= 50 and hasn't booked demo yet)
  if (user.lead_score >= 50 && user.lead_stage !== 'Demo Booked') {
    tagsToAssign.push('High Intent');
  } else {
    tagsToRemove.push('High Intent');
  }

  // Process Assignments
  for (const tag of tagsToAssign) {
    if (!currentTags.includes(tag)) {
      await assignTag(phone, tag);
      // Trigger side-effects based on segment entry
      await handleSegmentEntry(phone, tag, user);
    }
  }

  // Process Removals
  for (const tag of tagsToRemove) {
    if (currentTags.includes(tag)) {
      await removeTag(phone, tag);
    }
  }
}

/**
 * Executes actions based on segment categorization
 */
async function handleSegmentEntry(phone, tag, user) {
  await logEvent(phone, 'SEGMENT_CHANGE', `Entered Segment: ${tag}`, `User qualified for "${tag}" rules.`, { tag });

  if (tag === 'High Intent') {
    // Sync with CRM / Alert Sales Representative
    await logEvent(phone, 'CRM_WEBHOOK', 'Sales Notification Sent', `Lead ${phone} marked as HIGH INTENT. High Priority alert pushed to CRM.`, {
      phone,
      lead_score: user.lead_score,
      lead_stage: user.lead_stage
    });
  }

  if (tag === 'Math Wizard' && !phone.includes('9999988888') && !phone.includes('7777766666')) {
    // Update Lead Score for priority treatment
    await updateUser(phone, { lead_score: user.lead_score + 10 }); // +10 Wizard bonus!
  }
}
