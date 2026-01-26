import 'dotenv/config';

export const DID = process.env.DID ?? '';
export const SIGNING_KEY = process.env.SIGNING_KEY ?? '';
export const HOST = process.env.HOST ?? '127.0.0.1';
export const PORT = process.env.PORT ? Number(process.env.PORT) : 4100;
export const METRICS_PORT = process.env.METRICS_PORT ? Number(process.env.METRICS_PORT) : 4101;
export const FIREHOSE_URL = process.env.FIREHOSE_URL ?? 'wss://jetstream.atproto.tools/subscribe';
export const WANTED_COLLECTION = 'app.bsky.feed.post';
export const BSKY_IDENTIFIER = process.env.BSKY_IDENTIFIER ?? '';
export const BSKY_PASSWORD = process.env.BSKY_PASSWORD ?? '';
export const CURSOR_UPDATE_INTERVAL =
  process.env.CURSOR_UPDATE_INTERVAL ? Number(process.env.CURSOR_UPDATE_INTERVAL) : 60000;

// Face detection configuration
export const FACE_CONFIDENCE_THRESHOLD = process.env.FACE_CONFIDENCE_THRESHOLD
  ? Number(process.env.FACE_CONFIDENCE_THRESHOLD)
  : 0.6;
export const MAX_IMAGE_PROCESSING_TIME = process.env.MAX_IMAGE_PROCESSING_TIME
  ? Number(process.env.MAX_IMAGE_PROCESSING_TIME)
  : 10000;
export const MAX_QUEUE_SIZE = process.env.MAX_QUEUE_SIZE ? Number(process.env.MAX_QUEUE_SIZE) : 100;
export const QUEUE_CONCURRENCY = process.env.QUEUE_CONCURRENCY ? Number(process.env.QUEUE_CONCURRENCY) : 2;
export const PROCESS_ALL_POSTS = process.env.PROCESS_ALL_POSTS === 'true';
export const MIN_FOLLOWER_COUNT = process.env.MIN_FOLLOWER_COUNT
  ? Number(process.env.MIN_FOLLOWER_COUNT)
  : 1000;
