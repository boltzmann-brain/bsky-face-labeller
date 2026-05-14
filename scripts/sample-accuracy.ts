import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = 'labels.db';
const OUTPUT_DIR = 'accuracy-samples';
const SAMPLE_SIZE = 25;

const today = new Date().toISOString().slice(0, 10);
const outputPath = path.join(OUTPUT_DIR, `${today}.txt`);

const db = new Database(DB_PATH, { readonly: true });

function sample(labeled: boolean): string[] {
  const condition = labeled ? `labels != '[]'` : `labels = '[]'`;
  const rows = db
    .prepare(
      `SELECT bsky_url FROM post_log
       WHERE ${condition} AND processed_at > datetime('now', '-24 hours')
       ORDER BY RANDOM()
       LIMIT ?`,
    )
    .all(SAMPLE_SIZE) as { bsky_url: string }[];
  return rows.map((r) => r.bsky_url);
}

const labeled = sample(true);
const unlabeled = sample(false);

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const lines: string[] = [
  `# Accuracy sample — ${today}`,
  `# ${labeled.length} labeled posts, ${unlabeled.length} unlabeled posts`,
  '',
  '## Labeled (should contain target face)',
  ...labeled,
  '',
  '## Unlabeled (should NOT contain target face)',
  ...unlabeled,
];

fs.writeFileSync(outputPath, lines.join('\n') + '\n', 'utf8');
db.close();

console.log(`Written to ${outputPath}`);
console.log(`  Labeled:   ${labeled.length}`);
console.log(`  Unlabeled: ${unlabeled.length}`);
