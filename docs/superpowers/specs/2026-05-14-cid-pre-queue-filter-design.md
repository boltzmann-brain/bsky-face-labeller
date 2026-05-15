# CID Pre-Queue Filter Design

**Date:** 2026-05-14  
**Status:** Approved

## Problem

The processing queue regularly drops 60+ posts because it fills up faster than the queue workers can drain it. A significant fraction of those posts are reposts of the same image — the Jetstream delivers the same blob CID multiple times in bursts. These reposts go through the full download → phash → detection pipeline unnecessarily, consuming queue slots and causing other posts to be dropped.

## Goal

Reduce dropped posts by checking whether an image's result is already cached **before** adding a post to the queue. Cache hits bypass the queue entirely and apply labels immediately.

## Approach: CID column on `image_cache`

Each blob ref in a Bluesky post carries a `cid` field — a content-addressed identifier (cryptographic hash of the image bytes). Same CID = same bytes = same detection result. We can read the CID directly from the event record with no download.

We extend the existing `image_cache` table with a nullable `cid` column. Pre-queue, we check all CIDs for a post. If all are cached, we apply labels immediately without enqueueing. If any CID is uncached, we fall through to the queue where the existing phash path handles detection and populates the CID column for future lookups.

This keeps a single cache, a single eviction policy, and avoids any data duplication.

## Data Model

```sql
ALTER TABLE image_cache ADD COLUMN cid TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_image_cache_cid ON image_cache(cid);
```

Old rows have `NULL` CIDs and are unaffected. No backfill needed.

## Cache Operations (`imageCache.ts`)

### New: `getCachedResultByCid(cid: string): CachedResult | null`

Queries `image_cache WHERE cid = ?`. Same return shape as the existing `getCachedResult(phash)`. Updates `last_seen_at` and `seen_count` on hit.

### New: `storeCid(cid: string, phash: string): void`

Back-fills the `cid` column on an existing row identified by phash. Called after a phash hit inside the queue so future events for the same CID take the pre-queue fast path.

### Modified: `cacheResult(hash, detectedPeople, cid?)`

Accepts an optional `cid` parameter. When writing a new row (cache miss path), sets the `cid` column if provided.

## Pre-Queue Check Flow

In the Jetstream event handler (`main.ts`), after `hasImages()`:

1. Extract blob CIDs from `event.commit.record.embed.images[*].image.ref.$link`.
2. For each CID, call `getCachedResultByCid(cid)`.
3. **All CIDs hit:** merge detected-people sets from all results, call `logPost` + `labelPost` with the merged labels, increment `cid_cache_hits_total`, return without enqueueing. **No follower check needed** — the result is already known, so there is no download or detection to gate.
4. **Any CID misses:** apply the follower filter. If the poster has too few followers (and `PROCESS_ALL_POSTS` is false), skip without downloading. If the poster passes the filter, enqueue as today.

This makes the CID check the first real gate after `hasImages()`, before the follower network call. Low-follower accounts benefit from the cache (correct labeling) but are still skipped when their images are new (no wasted download).

## Queue Worker Changes (`imageProcessor.ts`)

After a **phash hit** inside `processSingleImage`:
- Call `storeCid(cid, phash)` to back-fill the CID on the cached row.

After a **phash miss** (detection completes):
- Pass `cid` to `cacheResult(phash, detectedPeople, cid)` so the new row has both columns set.

The blob CID must be threaded through from the event into `processSingleImage`. The `BlobRef` type already carries `ref` — `ref.$link` is the CID string.

## Metrics

Add one counter to `metrics.ts`:

| Metric | Description |
|--------|-------------|
| `cid_cache_hits_total` | Pre-queue CID hits; each increment = one post that bypassed the queue |

Existing counters (`image_cache_hits_total`, `image_cache_misses_total`) continue to reflect the phash path inside the queue, unchanged.

## What This Does Not Change

- The phash cache path inside the queue is unchanged.
- Cache eviction (`evictOldEntries`) operates on the same table with the same policy.
- Posts with any uncached CID go through the full queue pipeline as before.
- Near-duplicate detection (phash fuzzy matching) is unaffected — it still runs inside the queue on cache misses.

## Edge Cases

- **Multi-image posts, partial hit:** If a post has 3 images and 2 CIDs are cached but 1 is not, the post is enqueued. The queue worker handles all 3 images, which means the 2 cached images get phash hits and their CIDs are back-filled.
- **CID uniqueness conflict:** The `cid` column has a `UNIQUE` index. If two images share a phash but different CIDs (hash collision), `storeCid` is a no-op (CID already taken). This is cosmetically imperfect but not incorrect — the affected CID simply won't be pre-filtered in future.
- **Old rows without CIDs:** They are invisible to the pre-queue check and fall through to the queue as before. Their CIDs get back-filled the next time they appear in the queue via a phash hit.
