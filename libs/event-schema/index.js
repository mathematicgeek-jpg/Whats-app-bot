import { z } from 'zod';
import crypto from 'crypto';

export const EventNameEnum = z.enum([
  'USER_MESSAGE_RECEIVED',
  'GAME_QUESTION_SENT',
  'GAME_ANSWER_SUBMITTED',
  'USER_SEGMENT_UPDATED',
  'JOURNEY_STEP_COMPLETED'
]);

export const BaseEventSchema = z.object({
  event_id: z.string().uuid(),
  event_name: EventNameEnum,
  user_id: z.string(), // E.164 phone number
  timestamp: z.string().datetime(),
  payload: z.record(z.any())
});

export const UserMessageReceivedPayloadSchema = z.object({
  text: z.string(),
  is_button: z.boolean(),
  raw_payload: z.record(z.any()).optional()
});

export const GameQuestionSentPayloadSchema = z.object({
  level: z.number(),
  question_text: z.string(),
  is_hard_mode: z.boolean(),
  sent_timestamp: z.string()
});

export const GameAnswerSubmittedPayloadSchema = z.object({
  level: z.number(),
  answer: z.string(),
  is_correct: z.boolean(),
  response_time_ms: z.number(),
  attempts: z.number()
});

export const UserSegmentUpdatedPayloadSchema = z.object({
  previous_tags: z.array(z.string()),
  current_tags: z.array(z.string()),
  tag_added: z.string().optional(),
  tag_removed: z.string().optional()
});

export const JourneyStepCompletedPayloadSchema = z.object({
  workflow_id: z.string(),
  previous_node_id: z.string(),
  current_node_id: z.string(),
  variables: z.record(z.any())
});

/**
 * Creates and validates an event envelope
 * @param {string} name EventNameEnum value
 * @param {string} userId User identifier
 * @param {object} payload Event payload object
 * @returns {object} validated event envelope
 */
export function createEvent(name, userId, payload) {
  const event = {
    event_id: crypto.randomUUID(),
    event_name: name,
    user_id: userId,
    timestamp: new Date().toISOString(),
    payload
  };
  return BaseEventSchema.parse(event);
}
