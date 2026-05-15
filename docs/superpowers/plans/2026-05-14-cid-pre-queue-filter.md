# CID Pre-Queue Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CID-based cache check before the processing queue so posts with already-seen images bypass the queue entirely and get labels applied immediately.

**Architecture:** Each image blob in a Bluesky post carries a content-identifier (CID) in its blob ref. We extend `image_cache` with a nullable `cid` column, check all CIDs for a post before enqueuing, and short-circuit to immediate label application if all are cached. The queue worker back-fills the CID column as it processes images, so the pre-queue filter becomes more effective over time.

**Tech Stack:** TypeScript, better-sqlite3, prom-client, @skyware/jetstream

---

## File Map

| File | Change |
|------|--------|
| `src/db-setup.ts` | Add `cid` column migration and unique index |
| `src/imageCache.ts` | Add `getCachedResultByCid`, `storeCid`; modify `cacheResult` to accept optional `cid` |
| `src/metrics.ts` | Add `cidCacheHits` counter |
| `src/imageProcessor.ts` | Add `extractBlobCids` export; use `blob.ref.$link` as CID in `processSingleImage` to call `storeCid` on phash hit and pass `cid` to `cacheResult` on miss |
| `src/main.ts` | Import new functions; add CID pre-check before `processingQueue.enqueue()` |
| `test-cid-cache.ts` | New ad-hoc test script for the three new cache operations |

---

### Task 1: Migrate the database schema

**Files:**
- Modify: `src/db-setup.ts`

- [ ] **Step 1: Add cid migration to `setupDatabase`**

  In `src/db-setup.ts`, add this block immediately after the `db.exec(...)` call that creates the tables:

  ```typescript
  // Migrate: add cid column if not present
  const columns = db.pragma('table_info(image_cache)') as Array<{ name: string }>;
  if (!columns.some((col) => col.name === 'cid')) {
    db.exec('ALTER TABLE image_cache ADD COLUMN cid TEXT;');
    logger.info('Migration: added cid column to image_cache');
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_image_cache_cid ON image_cache(cid);');
  ```

  The full updated `setupDatabase` function should look like:

  ```typescript
  export function setupDatabase() {
    const db = new Database(DB_PATH);

    db.exec(`
      CREATE TABLE IF NOT EXISTS image_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phash TEXT NOT NULL UNIQUE,
        detected_people TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        seen_count INTEGER DEFAULT 1
      );

      CREATE INDEX IF NOT EXISTS idx_phash ON image_cache(phash);

      CREATE TABLE IF NOT EXISTS post_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bsky_url TEXT NOT NULL,
        labels TEXT NOT NULL DEFAULT '[]',
        processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_post_log_processed_at ON post_log(processed_at);
      CREATE INDEX IF NOT EXISTS idx_post_log_labels ON post_log(labels);
    `);

    // Migrate: add cid column if not present
    const columns = db.pragma('table_info(image_cache)') as Array<{ name: string }>;
    if (!columns.some((col) => col.name === 'cid')) {
      db.exec('ALTER TABLE image_cache ADD COLUMN cid TEXT;');
      logger.info('Migration: added cid column to image_cache');
    }
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_image_cache_cid ON image_cache(cid);');

    logger.info('Database schema initialized');
    db.close();
  }
  ```

- [ ] **Step 2: Run the migration**

  ```bash
  npx tsx src/db-setup.ts
  ```

  Expected output includes: `Migration: added cid column to image_cache` (first run) or just `Database schema initialized` (if column already exists from a previous run).

- [ ] **Step 3: Verify the schema**

  ```bash
  sqlite3 labels.db ".schema image_cache"
  ```

  Expected: output contains `cid TEXT` and `idx_image_cache_cid`.

- [ ] **Step 4: Commit**

  ```bash
  git add src/db-setup.ts
  git commit -m "feat: add cid column migration to image_cache schema"
  ```

---

### Task 2: Write the CID cache test script

**Files:**
- Create: `test-cid-cache.ts`

- [ ] **Step 1: Create the test file**

  ```typescript
  #!/usr/bin/env npx tsx
  /**
   * Tests for CID-based cache operations:
   *   getCachedResultByCid, storeCid, cacheResult (with cid parameter)
   */

  import { cacheResult, getCachedResultByCid, storeCid } from './src/imageCache.js';
  import logger from './src/logger.js';

  async function testCidCache() {
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

    // Test 3: storeCid back-fills a second CID onto the same row; getCachedResultByCid finds it
    logger.info('\n--- Test 3: storeCid back-fills cid ---');
    storeCid(cid2, phash1);
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
    storeCid(cid1, phash1); // cid already set to cid1 on phash1
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
  ```

- [ ] **Step 2: Run it — expect failure**

  ```bash
  npx tsx test-cid-cache.ts
  ```

  Expected: error like `SyntaxError: The requested module './src/imageCache.js' does not provide an export named 'getCachedResultByCid'`.

---

### Task 3: Implement the new cache operations

**Files:**
- Modify: `src/imageCache.ts`

- [ ] **Step 1: Add `getCachedResultByCid`**

  Add after the existing `getCachedResult` function:

  ```typescript
  /**
   * Get cached detection result by blob CID (content identifier).
   * Used for the pre-queue fast path before downloading images.
   */
  export function getCachedResultByCid(cid: string): CachedResult | null {
    try {
      const db = getDb();
      const row = db
        .prepare(
          `SELECT detected_people, seen_count, last_seen_at
           FROM image_cache
           WHERE cid = ?`,
        )
        .get(cid) as { detected_people: string; seen_count: number; last_seen_at: string } | undefined;

      if (row) {
        db.prepare(
          `UPDATE image_cache
           SET last_seen_at = CURRENT_TIMESTAMP, seen_count = seen_count + 1
           WHERE cid = ?`,
        ).run(cid);
        return {
          detectedPeople: JSON.parse(row.detected_people) as string[],
          seenCount: row.seen_count,
          lastSeenAt: row.last_seen_at,
        };
      }
      return null;
    } catch (error) {
      logger.error(`Error getting cached result by CID: ${error}`);
      return null;
    }
  }
  ```

- [ ] **Step 2: Add `storeCid`**

  Add after `getCachedResultByCid`:

  ```typescript
  /**
   * Back-fill the cid column on an existing image_cache row identified by phash.
   * Called after a phash hit inside the queue so future events for the same CID
   * take the pre-queue fast path.
   * No-op if the row already has a cid set.
   */
  export function storeCid(cid: string, phash: string): void {
    try {
      const db = getDb();
      db.prepare(
        `UPDATE image_cache SET cid = ? WHERE phash = ? AND cid IS NULL`,
      ).run(cid, phash);
    } catch (error) {
      logger.error(`Error storing CID: ${error}`);
    }
  }
  ```

- [ ] **Step 3: Modify `cacheResult` to accept an optional `cid`**

  Replace the existing `cacheResult` function with:

  ```typescript
  /**
   * Store detection result in cache.
   * Pass cid when available so the pre-queue CID filter can find this result next time.
   */
  export function cacheResult(hash: string, detectedPeople: string[], cid?: string): void {
    try {
      const db = getDb();
      db.prepare(
        `INSERT INTO image_cache (phash, detected_people, cid)
         VALUES (?, ?, ?)
         ON CONFLICT(phash) DO UPDATE SET
           detected_people = excluded.detected_people,
           cid = COALESCE(image_cache.cid, excluded.cid),
           last_seen_at = CURRENT_TIMESTAMP,
           seen_count = seen_count + 1`,
      ).run(hash, JSON.stringify(detectedPeople), cid ?? null);
    } catch (error) {
      logger.error(`Error caching result: ${error}`);
      // Don't throw - caching is not critical
    }
  }
  ```

  `COALESCE(image_cache.cid, excluded.cid)` preserves an existing CID on phash-conflict updates, and sets it when the row previously had none.

- [ ] **Step 4: Run the test script — expect all tests to pass**

  ```bash
  npx tsx test-cid-cache.ts
  ```

  Expected: `=== All CID cache tests passed! ===`

- [ ] **Step 5: Commit**

  ```bash
  git add src/imageCache.ts test-cid-cache.ts
  git commit -m "feat: add CID-based cache operations (getCachedResultByCid, storeCid)"
  ```

---

### Task 4: Add the `cidCacheHits` metric

**Files:**
- Modify: `src/metrics.ts`

- [ ] **Step 1: Add the counter**

  After the `cacheMisses` counter definition, add:

  ```typescript
  export const cidCacheHits = new Counter({
    name: 'cid_cache_hits_total',
    help: 'Posts that bypassed the queue via pre-queue CID cache hit',
    registers: [register],
  });
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add src/metrics.ts
  git commit -m "feat: add cid_cache_hits_total metric"
  ```

---

### Task 5: Thread CID through the image processing pipeline

**Files:**
- Modify: `src/imageProcessor.ts`

- [ ] **Step 1: Add `extractBlobCids` export**

  Add this function after `hasImages`:

  ```typescript
  /**
   * Extract blob CIDs from a post record's embed images.
   * Returns the CID strings without downloading any content.
   */
  export function extractBlobCids(record: any): string[] {
    if (!hasImages(record)) return [];
    const cids: string[] = [];
    for (const img of record.embed.images) {
      const link = img.image?.ref?.$link;
      if (typeof link === 'string') {
        cids.push(link);
      }
    }
    return cids;
  }
  ```

- [ ] **Step 2: Update imports at the top of `imageProcessor.ts`**

  Change:

  ```typescript
  import { cacheResult, computePhash, getCachedResult } from './imageCache.js';
  ```

  To:

  ```typescript
  import { cacheResult, computePhash, getCachedResult, storeCid } from './imageCache.js';
  ```

- [ ] **Step 3: Use the blob CID in `processSingleImage`**

  `blob.ref.$link` is the CID. Update `processSingleImage` to extract it and pass to cache operations. Replace the body of `processSingleImage` with:

  ```typescript
  async function processSingleImage(
    did: string,
    blob: BlobRef,
    index: number,
  ): Promise<{ person: string; confidence: number }[]> {
    const startTime = Date.now();
    const cid = blob.ref.$link;

    try {
      // Download the image
      logger.info(`Downloading image ${index + 1}...`);
      const imageBuffer = await downloadImageBlob(did, blob);
      const downloadTime = Date.now() - startTime;
      logger.info(`Image ${index + 1} downloaded (${downloadTime}ms, ${(blob.size / 1024).toFixed(1)}KB)`);

      // Compute perceptual hash
      logger.info(`Computing perceptual hash for image ${index + 1}...`);
      const phashStart = Date.now();
      const hash = await computePhash(imageBuffer);
      const phashTime = Date.now() - phashStart;
      logger.info(`Image ${index + 1} phash: ${hash} (${phashTime}ms)`);

      // Check cache by phash
      const cachedResult = getCachedResult(hash);
      if (cachedResult) {
        cacheHits.inc();
        logger.info(
          `Cache hit for image ${index + 1}! Previously seen ${cachedResult.seenCount} times. Detected: ${cachedResult.detectedPeople.length > 0 ? cachedResult.detectedPeople.join(', ') : 'none'}`,
        );
        // Back-fill CID so next occurrence is caught pre-queue
        storeCid(cid, hash);
        return cachedResult.detectedPeople.map((person) => ({ person, confidence: 1.0 }));
      }

      // Cache miss - perform face detection
      cacheMisses.inc();
      logger.info(`Cache miss for image ${index + 1}, performing face detection...`);
      const detectionStart = Date.now();
      const matches = await detectFaces(imageBuffer);
      const detectionTime = Date.now() - detectionStart;

      if (matches.length > 0) {
        logger.info(
          `Found ${matches.length} face(s) in image ${index + 1} (${detectionTime}ms): ${matches.map((m) => m.person).join(', ')}`,
        );
      } else {
        logger.info(`No recognized faces in image ${index + 1} (${detectionTime}ms)`);
      }

      // Store result with CID so pre-queue filter picks it up next time
      const detectedPeople = matches.map((m) => m.person);
      cacheResult(hash, detectedPeople, cid);

      return matches;
    } catch (error) {
      logger.error(`Failed to process image ${index + 1}: ${error}`);
      throw error;
    }
  }
  ```

- [ ] **Step 4: Verify TypeScript compiles**

  ```bash
  npm run lint
  ```

  Expected: no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add src/imageProcessor.ts
  git commit -m "feat: thread blob CID through image processing pipeline"
  ```

---

### Task 6: Add the pre-queue CID check in `main.ts`

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Update imports**

  Change:

  ```typescript
  import { closeCache, evictOldEntries, getCacheStats } from './imageCache.js';
  ```

  To:

  ```typescript
  import { closeCache, evictOldEntries, getCacheStats, getCachedResultByCid } from './imageCache.js';
  ```

  Change:

  ```typescript
  import { hasImages, processPostImages } from './imageProcessor.js';
  ```

  To:

  ```typescript
  import { extractBlobCids, hasImages, processPostImages } from './imageProcessor.js';
  ```

  Add to the metrics import:

  ```typescript
  import { cacheSize, cidCacheHits, startMetricsServer } from './metrics.js';
  ```

- [ ] **Step 2: Replace the `jetstream.onCreate` handler**

  Replace the existing `jetstream.onCreate` block with:

  ```typescript
  jetstream.onCreate(WANTED_COLLECTION, async (event: CommitCreateEvent<typeof WANTED_COLLECTION>) => {
    lastEventTime = Date.now();

    if (!hasImages(event.commit?.record)) {
      return;
    }

    // CID pre-filter runs before the follower check and before any download.
    // Even low-follower accounts get labeled when the image is already cached.
    const cids = extractBlobCids(event.commit?.record);
    if (cids.length > 0) {
      const results = cids.map((cid) => getCachedResultByCid(cid));
      if (results.every((r) => r !== null)) {
        const detectedPeople = new Set<string>();
        for (const r of results as NonNullable<ReturnType<typeof getCachedResultByCid>>[]) {
          for (const person of r.detectedPeople) detectedPeople.add(person);
        }
        const labelsToApply = Array.from(detectedPeople);
        const bskyUrl = `https://bsky.app/profile/${event.did}/post/${event.commit.rkey}`;
        logPost(bskyUrl, labelsToApply);
        if (labelsToApply.length > 0) {
          const postUri = `at://${event.did}/${WANTED_COLLECTION}/${event.commit.rkey}`;
          await labelPost(postUri, labelsToApply);
          logger.info(`CID cache: labeled ${postUri} with: ${labelsToApply.join(', ')}`);
        }
        cidCacheHits.inc();
        return;
      }
    }

    // CID not cached: apply follower filter before downloading.
    // Low-follower accounts are skipped here — no download wasted.
    if (!PROCESS_ALL_POSTS) {
      const hasFollowers = await hasEnoughFollowers(event.did);
      if (!hasFollowers) return;
    }

    processingQueue.enqueue(event);
  });
  ```

  Order: `hasImages` → CID check (all cached → label immediately) → follower filter (any CID uncached → skip if too few followers) → enqueue. Low-follower accounts benefit from the cache but are not downloaded when their images are new.

- [ ] **Step 3: Verify TypeScript compiles**

  ```bash
  npm run lint
  ```

  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add src/main.ts
  git commit -m "feat: add CID pre-queue filter to bypass queue for cached images"
  ```

---

### Task 7: Verify end-to-end

- [ ] **Step 1: Run DB migration**

  ```bash
  npx tsx src/db-setup.ts
  ```

  Expected: `Database schema initialized` (migration already applied in Task 1).

- [ ] **Step 2: Run CID cache test**

  ```bash
  npx tsx test-cid-cache.ts
  ```

  Expected: `=== All CID cache tests passed! ===`

- [ ] **Step 3: Run existing phash cache test**

  ```bash
  npx tsx test-phash-cache.ts
  ```

  Expected: `=== All tests passed! ===` (ensures `cacheResult` signature change is backward-compatible).

- [ ] **Step 4: Start services and check logs**

  ```bash
  npm run dev
  ```

  After the first viral/reposted image is processed:
  - First occurrence: logs `Cache miss for image 1, performing face detection...`
  - Subsequent occurrences: logs `CID cache: labeled ... with: ...` (from the pre-queue handler) — no queue slot consumed.

  Check that `cid_cache_hits_total` increments at `http://localhost:4101/metrics`.

- [ ] **Step 5: Final commit if any fixups**

  ```bash
  git add -p
  git commit -m "fix: <describe any fixup>"
  ```
