import { startConsumer, publishEvent } from '@mathgeek/event-bus';
import { createEvent } from '@mathgeek/event-schema';
import { pgPool } from '@mathgeek/db';
import { logger } from '@mathgeek/utils';

// Start Segmentation Consumer
async function start() {
  logger.info('Starting Segmentation/CDP Service consumer...');

  // Consume from game events to recalculate tags after quiz answers
  await startConsumer('segmentation-game-group', 'game-events', async (event) => {
    const { user_id } = event;
    await evaluateSegments(user_id);
  });

  // Consume from journey events to recalculate tags after profiling steps
  await startConsumer('segmentation-journey-group', 'journey-events', async (event) => {
    const { user_id } = event;
    await evaluateSegments(user_id);
  });
}

/**
 * Re-evaluates rules and assigns tags dynamically to users in Postgres
 */
async function evaluateSegments(phone) {
  if (phone === 'SYSTEM') return;

  const client = await pgPool.connect();
  try {
    // 1. Fetch User profile
    const userRes = await client.query('SELECT * FROM users WHERE phone_number = $1', [phone]);
    if (userRes.rows.length === 0) return;
    const user = userRes.rows[0];

    // 2. Fetch existing tags
    const tagsRes = await client.query('SELECT tag FROM user_tags WHERE user_phone = $1', [phone]);
    const currentTags = tagsRes.rows.map(r => r.tag);

    // 3. Fetch user performance
    const perfRes = await client.query('SELECT * FROM performance_data WHERE user_phone = $1', [phone]);
    const performances = perfRes.rows;

    const totalLevelsPlayed = performances.length;
    const correctCount = performances.filter(p => p.is_correct === 1).length;
    const avgResponseTime = totalLevelsPlayed > 0
      ? performances.reduce((sum, p) => sum + p.response_time_ms, 0) / totalLevelsPlayed
      : null;

    const accuracyRate = totalLevelsPlayed > 0 ? (correctCount / totalLevelsPlayed) * 100 : 0;

    const tagsToAssign = [];
    const tagsToRemove = [];

    // Rule 1: Math Wizard (Completed all 5 levels, 100% correct, avg speed < 6s)
    if (totalLevelsPlayed === 5 && correctCount === 5 && avgResponseTime && avgResponseTime < 6000) {
      tagsToAssign.push('Math Wizard');
    } else {
      tagsToRemove.push('Math Wizard');
    }

    // Rule 2: Struggling Learner (Accuracy < 60% after completing at least 3 levels)
    if (totalLevelsPlayed >= 3 && accuracyRate < 60) {
      tagsToAssign.push('Struggling Learner');
    } else {
      tagsToRemove.push('Struggling Learner');
    }

    // Rule 3: Speed Demon (Average Response Time < 4500ms after playing at least 3 levels)
    if (totalLevelsPlayed >= 3 && avgResponseTime && avgResponseTime < 4500) {
      tagsToAssign.push('Speed Demon');
    } else {
      tagsToRemove.push('Speed Demon');
    }

    // Rule 4: High Intent Lead (Lead Score >= 50 and hasn't booked demo yet)
    if (user.lead_score >= 50 && user.lead_stage !== 'Demo Booked') {
      tagsToAssign.push('High Intent');
    } else {
      tagsToRemove.push('High Intent');
    }

    // Process tag additions
    for (const tag of tagsToAssign) {
      if (!currentTags.includes(tag)) {
        await client.query(
          `INSERT INTO user_tags (user_phone, tag, assigned_at) VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [phone, tag, new Date().toISOString()]
        );
        logger.info(`Assigned dynamic tag "${tag}" to user ${phone}`);

        // Emit Segment change
        await publishEvent('segment-events', createEvent('USER_SEGMENT_UPDATED', phone, {
          previous_tags: currentTags,
          current_tags: [...currentTags, tag],
          tag_added: tag
        }));

        // CRM Sync alert webhook simulation for High Intent
        if (tag === 'High Intent') {
          logger.info(`🚨 Sales Alert: High Intent user detected: ${phone}`);
        }
        
        // Math Wizard bonus lead score update
        if (tag === 'Math Wizard' && !phone.includes('9999988888') && !phone.includes('7777766666')) {
          await client.query(
            'UPDATE users SET lead_score = lead_score + 10, updated_at = $1 WHERE phone_number = $2',
            [new Date().toISOString(), phone]
          );
        }
      }
    }

    // Process tag removals
    for (const tag of tagsToRemove) {
      if (currentTags.includes(tag)) {
        await client.query('DELETE FROM user_tags WHERE user_phone = $1 AND tag = $2', [phone, tag]);
        logger.info(`Removed dynamic tag "${tag}" from user ${phone}`);

        await publishEvent('segment-events', createEvent('USER_SEGMENT_UPDATED', phone, {
          previous_tags: currentTags,
          current_tags: currentTags.filter(t => t !== tag),
          tag_removed: tag
        }));
      }
    }

  } catch (err) {
    logger.error(`Error in evaluateSegments for ${phone}: ${err.message}`);
  } finally {
    client.release();
  }
}

start().catch(err => {
  logger.error(`Segmentation Service consumer startup failure: ${err.message}`);
  process.exit(1);
});
