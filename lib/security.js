/**
 * Webhook signature validation for Meta WhatsApp Cloud API.
 * Validates X-Hub-Signature-256 header using HMAC-SHA256.
 */

import crypto from 'crypto';

/**
 * Validate the X-Hub-Signature-256 header from Meta.
 * @param {string|Buffer} rawBody - The raw request body (unparsed string)
 * @param {string} signatureHeader - Value of X-Hub-Signature-256 header (e.g., "sha256=abc123...")
 * @param {string} appSecret - The Meta App Secret
 * @returns {boolean} true if signature is valid
 */
export function validateSignature(rawBody, signatureHeader, appSecret) {
  if (!signatureHeader || !appSecret) {
    return false;
  }

  const [algo, receivedHash] = signatureHeader.split('=');
  if (algo !== 'sha256' || !receivedHash) {
    return false;
  }

  const expectedHash = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody, 'utf-8')
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(receivedHash, 'hex'),
      Buffer.from(expectedHash, 'hex')
    );
  } catch {
    return false;
  }
}
