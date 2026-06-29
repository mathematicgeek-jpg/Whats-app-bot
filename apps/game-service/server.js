import Fastify from 'fastify';
import dotenv from 'dotenv';
import { startConsumer } from '@mathgeek/event-bus';
import { pgPool } from '@mathgeek/db';
import { logger } from '@mathgeek/utils';

dotenv.config();

const fastify = Fastify({ logger: false });
const PORT = process.env.PORT || 3002;

// Hardcoded Vedic Math database
const GAME_QUESTIONS = {
  1: {
    normal: { question: "Multiply 35 by 11. What is the answer? 🧠", answer: 385, trick: "Vedic trick: For any 2-digit number multiplied by 11, add the two digits (3 + 5 = 8) and place the sum in the middle to get 385! Easy as pie 🥧" },
    hard: { question: "🔥 Hard Challenge: Multiply 78 by 11. What is the answer? 🧠", answer: 858, trick: "Vedic trick: 7 + 8 = 15. Carry the 1 over to the 7 (7 + 1 = 8) and place 5 in the middle: 858!" }
  },
  2: {
    normal: { question: "Multiply 65 by 65 (65 squared). What is the answer? ⚡", answer: 4225, trick: "Vedic trick: For numbers ending in 5, multiply the tens digit by the next consecutive number (6 x 7 = 42) and write 25 at the end. Combined: 4225!" },
    hard: { question: "🔥 Hard Challenge: Multiply 95 by 95 (95 squared). What is the answer? ⚡", answer: 9025, trick: "Vedic trick: Multiply the tens digit by the next consecutive number (9 x 10 = 90) and write 25 at the end. Combined: 9025!" }
  },
  3: {
    normal: { question: "Multiply 96 by 97. What is the answer? (Base 100 subtraction method) 🎯", answer: 9312, trick: "Vedic trick: Both are close to 100. 96 is -4 below, 97 is -3 below. Cross-subtract: 96 - 3 = 93. Multiply deficiencies: 4 x 3 = 12. Combined: 9312! 🤯" },
    hard: { question: "🔥 Hard Challenge: Multiply 91 by 98. What is the answer? (Base 100 subtraction method) 🎯", answer: 8918, trick: "Vedic trick: 91 is -9 below, 98 is -2 below. Cross-subtract: 91 - 2 = 89. Multiply deficiencies: 9 x 2 = 18. Combined: 8918!" }
  },
  4: {
    normal: { question: "Multiply 103 by 105. What is the answer? (Base 100 addition method) 📈", answer: 10815, trick: "Vedic trick: Both are above 100. 103 is +3, 105 is +5. Cross-add: 103 + 5 = 108. Multiply surpluses: 3 x 5 = 15. Combined: 10815!" },
    hard: { question: "🔥 Hard Challenge: Multiply 107 by 108. What is the answer? (Base 100 addition method) 📈", answer: 11556, trick: "Vedic trick: 107 is +7, 108 is +8. Cross-add: 107 + 8 = 115. Multiply surpluses: 7 x 8 = 56. Combined: 11556!" }
  },
  5: {
    normal: { question: "Multiply 991 by 996. What is the answer? (Near 1000 method) 🏆", answer: 987036, trick: "Vedic trick: Base is 1000. Deficits are -9 and -4. Cross-subtract: 991 - 4 = 987. Multiply deficits: 9 x 4 = 36 (pad to 3 digits as 036). Combined: 987036!" },
    hard: { question: "🔥 Hard Challenge: Multiply 988 by 995. What is the answer? (Near 1000 method) 🏆", answer: 983060, trick: "Vedic trick: Base is 1000. Deficits are -12 and -5. Cross-subtract: 988 - 5 = 983. Multiply deficits: 12 x 5 = 60 (pad to 3 digits as 060). Combined: 983060!" }
  }
};

// Health Check
fastify.get('/health', async () => ({ status: 'healthy', service: 'game-service' }));

// Get Question Endpoint
fastify.get('/api/game/question', async (request, reply) => {
  const { level, isHardMode } = request.query;
  const lvlNum = parseInt(level, 10) || 1;
  const hardBool = isHardMode === 'true';

  const levelData = GAME_QUESTIONS[lvlNum];
  if (!levelData) {
    return reply.code(404).send({ error: `Level ${lvlNum} not found.` });
  }

  const q = hardBool ? levelData.hard : levelData.normal;
  return { level: lvlNum, question: q.question };
});

// Check Answer Endpoint
fastify.post('/api/game/check', async (request, reply) => {
  const { level, answer, isHardMode } = request.body || {};
  const lvlNum = parseInt(level, 10) || 1;
  const hardBool = !!isHardMode;

  const levelData = GAME_QUESTIONS[lvlNum];
  if (!levelData) {
    return reply.code(404).send({ error: `Level ${lvlNum} not found.` });
  }

  const data = hardBool ? levelData.hard : levelData.normal;
  const parsedAnswer = parseInt(answer.replace(/[^\d-]/g, ''), 10);

  return {
    correct: parsedAnswer === data.answer,
    trick: data.trick,
    expectedAnswer: data.answer
  };
});

// Event-driven Logging Consumer
async function startEventConsumer() {
  await startConsumer('game-service-group', 'game-events', async (event) => {
    const { user_id, timestamp, payload } = event;
    const { level, answer, is_correct, response_time_ms, attempts } = payload;
    
    logger.info(`Logging performance to Postgres for user ${user_id}, Level ${level}`);

    const id = 'perf_' + Math.random().toString(36).substr(2, 9);
    const conceptTag = `level_${level}_${payload.is_hard_mode ? 'hard' : 'normal'}`;

    try {
      await pgPool.query(
        `INSERT INTO performance_data (id, user_phone, level, concept_tag, is_correct, response_time_ms, attempts, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, user_id, level, conceptTag, is_correct ? 1 : 0, response_time_ms, attempts, timestamp]
      );
    } catch (err) {
      logger.error(`Failed to insert quiz performance into Postgres: ${err.message}`);
    }
  });
}

// Start Server
const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`🚀 Game Service running on http://localhost:${PORT}`);
    await startEventConsumer();
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
