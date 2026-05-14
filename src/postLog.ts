import Database from 'better-sqlite3';

import logger from './logger.js';

const DB_PATH = 'labels.db';

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
  }
  return db;
}

export function logPost(bskyUrl: string, labels: string[]): void {
  try {
    getDb()
      .prepare('INSERT INTO post_log (bsky_url, labels) VALUES (?, ?)')
      .run(bskyUrl, JSON.stringify(labels));
  } catch (error) {
    logger.error(`Error logging post: ${error}`);
  }
}

export function cleanOldPostLogs(maxAgeDays: number): void {
  try {
    const result = getDb()
      .prepare(`DELETE FROM post_log WHERE processed_at < datetime('now', '-' || ? || ' days')`)
      .run(maxAgeDays);
    if (result.changes > 0) {
      logger.info(`Post log cleanup: removed ${result.changes} entries older than ${maxAgeDays} days`);
    }
  } catch (error) {
    logger.error(`Error cleaning post log: ${error}`);
  }
}

export function closePostLog(): void {
  if (db) {
    db.close();
    db = null;
  }
}
