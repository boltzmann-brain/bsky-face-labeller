#!/usr/bin/env npx tsx
/**
 * Tests for CID-based cache operations:
 *   getCachedResultByCid, storeCid, cacheResult (with cid parameter)
 */

import { cacheResult, getCachedResultByCid, storeCid } from './src/imageCache.js';
import logger from './src/logger.js';

async function testCidCache() {
  await Promise.resolve();
  logger.info('=== Testing CID Cache Operations ===');

  const ts = Date.now();
  const phash1 = `test_phash_${ts}`;
  const cid1 = `bafytest1_${ts}`;
  const cid2 = `bafytest2_${ts}`;
  const people = ['trump'];

  // Test 1: getCachedResultByCid returns null for unknown CID
  logger.info('\n--- Test 1: getCachedResultByCid miss ---');
  const miss = getCachedResultByCid(cid1);
  if (miss !== null) {
    logger.error('FAIL: expected null for unknown CID');
    process.exit(1);
  }
  logger.info('PASS');

  // Test 2: cacheResult with cid; getCachedResultByCid finds it
  logger.info('\n--- Test 2: cacheResult with cid ---');
  cacheResult(phash1, people, cid1);
  const hit1 = getCachedResultByCid(cid1);
  if (!hit1) {
    logger.error('FAIL: expected cache hit after cacheResult with cid');
    process.exit(1);
  }
  if (JSON.stringify(hit1.detectedPeople) !== JSON.stringify(people)) {
    logger.error(`FAIL: expected ${JSON.stringify(people)}, got ${JSON.stringify(hit1.detectedPeople)}`);
    process.exit(1);
  }
  logger.info(`PASS: detectedPeople=${JSON.stringify(hit1.detectedPeople)}, seenCount=${hit1.seenCount}`);

  // Test 3: storeCid back-fills a new CID on a row without one; getCachedResultByCid finds it
  logger.info('\n--- Test 3: storeCid back-fills cid on row without cid ---');
  // Create a new cache entry without a cid (e.g., from offline detection)
  const phash2 = `test_phash2_${ts}`;
  cacheResult(phash2, people); // No cid provided
  storeCid(phash2, cid2); // Back-fill the cid
  const hit2 = getCachedResultByCid(cid2);
  if (!hit2) {
    logger.error('FAIL: expected cache hit after storeCid');
    process.exit(1);
  }
  if (JSON.stringify(hit2.detectedPeople) !== JSON.stringify(people)) {
    logger.error(`FAIL: expected ${JSON.stringify(people)}, got ${JSON.stringify(hit2.detectedPeople)}`);
    process.exit(1);
  }
  logger.info(`PASS: detectedPeople=${JSON.stringify(hit2.detectedPeople)}, seenCount=${hit2.seenCount}`);

  // Test 4: storeCid is a no-op when cid already set (no crash)
  logger.info('\n--- Test 4: storeCid is idempotent ---');
  storeCid(phash1, cid1); // cid already set to cid1 on phash1
  const hit3 = getCachedResultByCid(cid1);
  if (!hit3) {
    logger.error('FAIL: lost cid1 after duplicate storeCid call');
    process.exit(1);
  }
  logger.info('PASS');

  logger.info('\n=== All CID cache tests passed! ===');
}

testCidCache().catch((error: unknown) => {
  logger.error(`Test failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
