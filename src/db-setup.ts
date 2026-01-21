import Database from 'better-sqlite3';
import logger from './logger.js';

const DB_PATH = 'labels.db';

/**
 * Initialize the database schema for image cache
 */
export function setupDatabase() {
  const db = new Database(DB_PATH);

  // Create image_cache table to store perceptual hashes and detection results
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
  `);

  logger.info('Database schema initialized');
  db.close();
}

// Run setup if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  setupDatabase();
}
