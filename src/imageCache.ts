import Database from 'better-sqlite3';
import phash from 'sharp-phash';

import logger from './logger.js';

const DB_PATH = 'labels.db';

interface CachedResult {
  detectedPeople: string[];
  seenCount: number;
  lastSeenAt: string;
}

// Lazy-initialize database connection
let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL'); // Better concurrency
  }
  return db;
}

/**
 * Compute perceptual hash for an image buffer
 */
export async function computePhash(imageBuffer: Buffer): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const hash = await phash(imageBuffer);
    return hash as string;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error computing phash: ${errorMessage}`);
    throw new Error(`Failed to compute perceptual hash: ${errorMessage}`);
  }
}

/**
 * Get cached detection result for an image hash
 */
export function getCachedResult(hash: string): CachedResult | null {
  try {
    const db = getDb();
    const stmt = db.prepare(`
      SELECT detected_people, seen_count, last_seen_at
      FROM image_cache
      WHERE phash = ?
    `);

    const row = stmt.get(hash) as
      | { detected_people: string; seen_count: number; last_seen_at: string }
      | undefined;

    if (row) {
      // Update last_seen_at and increment seen_count
      const updateStmt = db.prepare(`
        UPDATE image_cache
        SET last_seen_at = CURRENT_TIMESTAMP,
            seen_count = seen_count + 1
        WHERE phash = ?
      `);
      updateStmt.run(hash);

      return {
        detectedPeople: JSON.parse(row.detected_people) as string[],
        seenCount: row.seen_count,
        lastSeenAt: row.last_seen_at,
      };
    }

    return null;
  } catch (error) {
    logger.error(`Error getting cached result: ${error}`);
    return null;
  }
}

/**
 * Store detection result in cache
 */
export function cacheResult(hash: string, detectedPeople: string[]): void {
  try {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO image_cache (phash, detected_people)
      VALUES (?, ?)
      ON CONFLICT(phash) DO UPDATE SET
        detected_people = excluded.detected_people,
        last_seen_at = CURRENT_TIMESTAMP,
        seen_count = seen_count + 1
    `);

    stmt.run(hash, JSON.stringify(detectedPeople));
  } catch (error) {
    logger.error(`Error caching result: ${error}`);
    // Don't throw - caching is not critical
  }
}

/**
 * Get cache statistics
 */
export function getCacheStats(): {
  totalEntries: number;
  entriesWithDetections: number;
  entriesWithoutDetections: number;
} {
  try {
    const db = getDb();

    const totalStmt = db.prepare('SELECT COUNT(*) as count FROM image_cache');
    const total = (totalStmt.get() as { count: number }).count;

    const withDetectionsStmt = db.prepare(
      "SELECT COUNT(*) as count FROM image_cache WHERE detected_people != '[]'",
    );
    const withDetections = (withDetectionsStmt.get() as { count: number }).count;

    return {
      totalEntries: total,
      entriesWithDetections: withDetections,
      entriesWithoutDetections: total - withDetections,
    };
  } catch (error) {
    logger.error(`Error getting cache stats: ${error}`);
    return {
      totalEntries: 0,
      entriesWithDetections: 0,
      entriesWithoutDetections: 0,
    };
  }
}

/**
 * Evict old cache entries that haven't been seen in maxAgeDays
 */
export function evictOldEntries(maxAgeDays: number): number {
  try {
    const db = getDb();
    const stmt = db.prepare(`
      DELETE FROM image_cache
      WHERE last_seen_at < datetime('now', '-' || ? || ' days')
    `);
    const result = stmt.run(maxAgeDays);
    
    if (result.changes > 0) {
      logger.info(`Cache cleanup: evicted ${result.changes} entries older than ${maxAgeDays} days`);
      // Run VACUUM to reclaim disk space (do this periodically, not every cleanup)
      db.exec('PRAGMA incremental_vacuum;');
    }
    
    return result.changes;
  } catch (error) {
    logger.error(`Error evicting old cache entries: ${error}`);
    return 0;
  }
}

/**
 * Close database connection (call on shutdown)
 */
export function closeCache(): void {
  if (db) {
    db.close();
    db = null;
  }
}
