import { Kafka } from 'kafkajs';
import { redis } from '@mathgeek/db';
import { logger } from '@mathgeek/utils';
import Redis from 'ioredis';

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const BUS_TYPE = process.env.EVENT_BUS_TYPE || 'redis'; // 'kafka' or 'redis'

let kafka;
let producer;
const activeConsumers = [];

// Initialize Kafka if selected
if (BUS_TYPE === 'kafka') {
  kafka = new Kafka({
    clientId: 'mathgeek-platform',
    brokers: KAFKA_BROKERS,
    retry: {
      initialRetryTime: 100,
      retries: 8
    }
  });
  producer = kafka.producer();
}

/**
 * Publish an event onto the Event Bus
 * @param {string} topic Target stream / topic name
 * @param {object} event Standard BaseEvent payload
 */
export async function publishEvent(topic, event) {
  const payloadStr = JSON.stringify(event);

  if (BUS_TYPE === 'kafka') {
    try {
      if (!producer) {
        producer = kafka.producer();
      }
      await producer.connect();
      await producer.send({
        topic,
        messages: [{ key: event.user_id, value: payloadStr }]
      });
      logger.debug(`Published event to Kafka topic ${topic}: ${event.event_name}`);
    } catch (err) {
      logger.error(`Failed to publish event to Kafka: ${err.message}`, { topic, event });
      throw err;
    }
  } else {
    // Redis Pub/Sub Fallback
    try {
      await redis.publish(topic, payloadStr);
      logger.debug(`Published event to Redis topic ${topic}: ${event.event_name}`);
    } catch (err) {
      logger.error(`Failed to publish event to Redis: ${err.message}`, { topic, event });
      throw err;
    }
  }
}

/**
 * Start a consumer on the Event Bus
 * @param {string} groupId Consumer Group identifier
 * @param {string} topic Stream / topic name
 * @param {function} onMessageAsync Callback function (eventPayload) => Promise<void>
 */
export async function startConsumer(groupId, topic, onMessageAsync) {
  if (BUS_TYPE === 'kafka') {
    try {
      const consumer = kafka.consumer({ groupId });
      await consumer.connect();
      await consumer.subscribe({ topic, fromBeginning: false });
      
      await consumer.run({
        eachMessage: async ({ message }) => {
          const raw = message.value.toString();
          const event = JSON.parse(raw);
          try {
            await onMessageAsync(event);
          } catch (err) {
            logger.error(`Error in consumer callback: ${err.message}`, { groupId, topic, event_id: event.event_id });
            // Send to DLQ (Dead Letter Queue) in production
            await publishEvent(`${topic}-dlq`, {
              event,
              error: err.message,
              failed_at: new Date().toISOString()
            });
          }
        }
      });
      activeConsumers.push(consumer);
      logger.info(`Kafka Consumer started: Group="${groupId}", Topic="${topic}"`);
    } catch (err) {
      logger.error(`Failed to start Kafka consumer: ${err.message}`, { groupId, topic });
      throw err;
    }
  } else {
    // Redis Pub/Sub Consumer Fallback
    try {
      // Create dedicated subscription client because Redis connection cannot do regular commands once subscribed
      const subClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
      
      await subClient.subscribe(topic);
      subClient.on('message', async (channel, message) => {
        if (channel === topic) {
          const event = JSON.parse(message);
          try {
            await onMessageAsync(event);
          } catch (err) {
            logger.error(`Error in Redis consumer callback: ${err.message}`, { groupId, topic, event_id: event.event_id });
            await publishEvent(`${topic}-dlq`, {
              event,
              error: err.message,
              failed_at: new Date().toISOString()
            });
          }
        }
      });
      
      activeConsumers.push(subClient);
      logger.info(`Redis PubSub Subscriber started: Group="${groupId}", Topic="${topic}"`);
    } catch (err) {
      logger.error(`Failed to start Redis subscriber: ${err.message}`, { groupId, topic });
      throw err;
    }
  }
}

/**
 * Gracefully close all event bus connections
 */
export async function closeEventBus() {
  if (BUS_TYPE === 'kafka') {
    if (producer) await producer.disconnect();
    for (const c of activeConsumers) {
      await c.disconnect();
    }
  } else {
    for (const sub of activeConsumers) {
      sub.disconnect();
    }
  }
  logger.info('Event Bus connections closed.');
}
