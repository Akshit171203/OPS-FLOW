import { createHash, randomBytes } from 'node:crypto';

export const API_KEY_PREFIX = 'ofk_';
/** "ofk_" plus 32 random bytes, base64url encoded: 256 bits of entropy. */
const WELL_FORMED = /^ofk_[A-Za-z0-9_-]{43}$/;

export const generateApiKey = () => `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;

export const looksLikeApiKey = (value: string) => WELL_FORMED.test(value);

/**
 * Keys are random and long, so there is nothing to brute-force and a fast hash is the right tool
 * (a slow password hash would only add latency to every request). Only the hash is stored.
 */
export const hashApiKey = (key: string) => createHash('sha256').update(key).digest('hex');

/** Enough of the key to recognise it in a list, never enough to use it. */
export const keyPrefix = (key: string) => key.slice(0, API_KEY_PREFIX.length + 6);
