#!/usr/bin/env npx tsx
/**
 * Test perceptual hash caching
 *
 * This script tests that:
 * 1. Images can be hashed
 * 2. Cache stores and retrieves results correctly
 * 3. Duplicate images are detected
 */

import fs from 'node:fs';
import { cacheResult, computePhash, getCachedResult, getCacheStats } from './src/imageCache.js';
import logger from './src/logger.js';

async function testPhashCache() {
  logger.info('=== Testing Perceptual Hash Cache ===');

  // Find a test image
  const testImageDir = './reference-faces/trumpface';
  if (!fs.existsSync(testImageDir)) {
    logger.error('No test images found. Please add reference images first.');
    process.exit(1);
  }

  const imageRegex = /\.(jpg|jpeg|png)$/i;
  const files = fs.readdirSync(testImageDir).filter(f => imageRegex.exec(f));
  if (files.length === 0) {
    logger.error('No image files found in reference-faces/trumpface/');
    process.exit(1);
  }

  const testImagePath = `${testImageDir}/${files[0]}`;
  logger.info(`Using test image: ${testImagePath}`);

  // Read the image
  const imageBuffer = fs.readFileSync(testImagePath);
  logger.info(`Image size: ${(imageBuffer.length / 1024).toFixed(1)}KB`);

  // Test 1: Compute perceptual hash
  logger.info('\n--- Test 1: Compute perceptual hash ---');
  const hash1 = await computePhash(imageBuffer);
  logger.info(`Computed hash: ${hash1}`);

  // Test 2: Compute hash again (should be identical)
  logger.info('\n--- Test 2: Hash consistency ---');
  const hash2 = await computePhash(imageBuffer);
  if (hash1 === hash2) {
    logger.info('✓ Hash is consistent across multiple computations');
  } else {
    logger.error('✗ Hash mismatch! Something is wrong.');
    logger.error(`Hash 1: ${hash1}`);
    logger.error(`Hash 2: ${hash2}`);
    process.exit(1);
  }

  // Test 3: Cache miss (first lookup)
  logger.info('\n--- Test 3: Cache miss ---');
  const result1 = getCachedResult(hash1);
  if (result1 === null) {
    logger.info('✓ Cache miss (as expected for new hash)');
  } else {
    logger.info('⚠ Cache hit (hash already exists in database)');
    logger.info(`  Detected people: ${result1.detectedPeople.join(', ') || 'none'}`);
    logger.info(`  Seen count: ${result1.seenCount}`);
  }

  // Test 4: Store in cache
  logger.info('\n--- Test 4: Cache storage ---');
  const detectedPeople = ['trump'];
  cacheResult(hash1, detectedPeople);
  logger.info(`✓ Stored result in cache: ${detectedPeople.join(', ')}`);

  // Test 5: Cache hit (second lookup)
  logger.info('\n--- Test 5: Cache hit ---');
  const result2 = getCachedResult(hash1);
  if (result2 !== null) {
    logger.info('✓ Cache hit!');
    logger.info(`  Detected people: ${result2.detectedPeople.join(', ')}`);
    logger.info(`  Seen count: ${result2.seenCount}`);

    if (JSON.stringify(result2.detectedPeople) === JSON.stringify(detectedPeople)) {
      logger.info('✓ Cached data matches what we stored');
    } else {
      logger.error('✗ Cached data does not match!');
      process.exit(1);
    }
  } else {
    logger.error('✗ Cache miss! Should have been a hit.');
    process.exit(1);
  }

  // Test 6: Cache stats
  logger.info('\n--- Test 6: Cache statistics ---');
  const stats = getCacheStats();
  logger.info(`Total entries: ${stats.totalEntries}`);
  logger.info(`Entries with detections: ${stats.entriesWithDetections}`);
  logger.info(`Entries without detections: ${stats.entriesWithoutDetections}`);

  // Test 7: Cache empty result
  logger.info('\n--- Test 7: Cache empty result (no faces detected) ---');
  // Create a fake hash for testing
  const fakeHash = `test_no_faces_${Date.now()}`;
  cacheResult(fakeHash, []); // Empty array = no faces
  logger.info('✓ Stored empty result');

  const result3 = getCachedResult(fakeHash);
  if (result3 !== null && result3.detectedPeople.length === 0) {
    logger.info('✓ Retrieved empty result correctly');
  } else {
    logger.error('✗ Failed to retrieve empty result');
    process.exit(1);
  }

  logger.info('\n=== All tests passed! ===');
}

testPhashCache().catch((error: unknown) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  logger.error(`Test failed: ${errorMessage}`);
  process.exit(1);
});
