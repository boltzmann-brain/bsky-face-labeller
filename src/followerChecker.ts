import { AtpAgent } from '@atproto/api';

import { BSKY_IDENTIFIER, BSKY_PASSWORD, MIN_FOLLOWER_COUNT } from './config.js';
import logger from './logger.js';

interface FollowerCache {
  count: number;
  timestamp: number;
}

const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const followerCache = new Map<string, FollowerCache>();

// Rate limiting: track pending requests and add delay between API calls
let lastApiCall = 0;
const MIN_API_INTERVAL = 100; // Minimum 100ms between API calls
let pendingRequests = 0;
const MAX_PENDING_REQUESTS = 10; // Max concurrent lookups

let agent: AtpAgent | null = null;

/**
 * Initialize the Bluesky agent for API calls
 */
export async function initializeFollowerChecker(): Promise<void> {
  try {
    agent = new AtpAgent({ service: 'https://bsky.social' });
    await agent.login({
      identifier: BSKY_IDENTIFIER,
      password: BSKY_PASSWORD,
    });
    logger.info('Follower checker initialized');
  } catch (error) {
    logger.error(`Failed to initialize follower checker: ${error}`);
    throw error;
  }
}

/**
 * Check if a DID has enough followers to process their posts
 */
export async function hasEnoughFollowers(did: string): Promise<boolean> {
  // If MIN_FOLLOWER_COUNT is 0, process all posts
  if (MIN_FOLLOWER_COUNT === 0) {
    return true;
  }

  // Check cache first
  const cached = followerCache.get(did);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.count >= MIN_FOLLOWER_COUNT;
  }

  // Rate limit: skip if too many pending requests (assume not enough followers)
  if (pendingRequests >= MAX_PENDING_REQUESTS) {
    return false;
  }

  // Fetch follower count from API
  try {
    if (!agent) {
      logger.warn('Follower checker not initialized, allowing post');
      return true;
    }

    // Rate limit: wait if we're calling too fast
    const now = Date.now();
    const timeSinceLastCall = now - lastApiCall;
    if (timeSinceLastCall < MIN_API_INTERVAL) {
      await new Promise((resolve) => setTimeout(resolve, MIN_API_INTERVAL - timeSinceLastCall));
    }

    pendingRequests++;
    lastApiCall = Date.now();

    const profile = await agent.getProfile({ actor: did });
    const followerCount = profile.data.followersCount || 0;

    pendingRequests--;

    // Cache the result
    followerCache.set(did, {
      count: followerCount,
      timestamp: Date.now(),
    });

    const hasEnough = followerCount >= MIN_FOLLOWER_COUNT;
    if (!hasEnough) {
      logger.debug(`Skipping post from ${did} (${followerCount} followers, need ${MIN_FOLLOWER_COUNT})`);
    }

    return hasEnough;
  } catch (error) {
    pendingRequests--;
    // On rate limit, don't log every error - just skip the post
    const errorStr = String(error);
    if (errorStr.includes('Rate Limit')) {
      return false; // Skip post when rate limited
    }
    logger.error(`Error fetching follower count for ${did}: ${error}`);
    // On other errors, skip the post to be safe
    return false;
  }
}

/**
 * Get cache statistics
 */
export function getFollowerCacheStats() {
  return {
    size: followerCache.size,
    entries: followerCache.size,
  };
}

/**
 * Clear old cache entries
 */
export function cleanFollowerCache(): void {
  const now = Date.now();
  let cleaned = 0;

  for (const [did, cache] of followerCache.entries()) {
    if (now - cache.timestamp > CACHE_TTL) {
      followerCache.delete(did);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.info(`Cleaned ${cleaned} expired follower cache entries`);
  }
}

// Clean cache every hour
setInterval(cleanFollowerCache, CACHE_TTL);
