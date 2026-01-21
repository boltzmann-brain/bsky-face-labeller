import { CommitCreateEvent, Jetstream } from '@skyware/jetstream';
import WebSocket from 'ws';
import fs from 'node:fs';

import {
  CURSOR_UPDATE_INTERVAL,
  FIREHOSE_URL,
  HOST,
  MAX_QUEUE_SIZE,
  METRICS_PORT,
  MIN_FOLLOWER_COUNT,
  PORT,
  PROCESS_ALL_POSTS,
  WANTED_COLLECTION,
} from './config.js';
import { initializeFaceDetection, loadReferenceFaces } from './faceDetection.js';
import { hasEnoughFollowers, initializeFollowerChecker } from './followerChecker.js';
import { closeCache, getCacheStats } from './imageCache.js';
import { hasImages, processPostImages } from './imageProcessor.js';
import { labelPost, labelerServer } from './label.js';
import logger from './logger.js';
import { cacheSize, startMetricsServer } from './metrics.js';
import { ProcessingQueue } from './queue.js';

let cursor = 0;
let cursorUpdateInterval: NodeJS.Timeout;

function epochUsToDateTime(cursor: number): string {
  return new Date(cursor / 1000).toISOString();
}

async function main() {
  try {
    logger.info('Trying to read cursor from cursor.txt...');
    cursor = Number(fs.readFileSync('cursor.txt', 'utf8'));
    logger.info(`Cursor found: ${cursor} (${epochUsToDateTime(cursor)})`);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      cursor = Math.floor(Date.now() * 1000);
      logger.info(`Cursor not found in cursor.txt, setting cursor to: ${cursor} (${epochUsToDateTime(cursor)})`);
      fs.writeFileSync('cursor.txt', cursor.toString(), 'utf8');
    } else {
      logger.error(error);
      process.exit(1);
    }
  }

  // Initialize face detection before starting Jetstream
  logger.info('Initializing face detection...');
  try {
    await initializeFaceDetection();
    await loadReferenceFaces();
    logger.info('Face detection initialization complete');

    // Log cache statistics
    const cacheStats = getCacheStats();
    logger.info(
      `Image cache loaded: ${cacheStats.totalEntries} total entries (${cacheStats.entriesWithDetections} with detections, ${cacheStats.entriesWithoutDetections} without)`,
    );
  } catch (error) {
    logger.error(`Failed to initialize face detection: ${error}`);
    process.exit(1);
  }

  // Initialize follower checker if not processing all posts
  if (!PROCESS_ALL_POSTS && MIN_FOLLOWER_COUNT > 0) {
    logger.info(`Initializing follower checker (min followers: ${MIN_FOLLOWER_COUNT})...`);
    try {
      await initializeFollowerChecker();
      logger.info('Follower checker initialized');
    } catch (error) {
      logger.error(`Failed to initialize follower checker: ${error}`);
      process.exit(1);
    }
  }

  const jetstream = new Jetstream({
    wantedCollections: [WANTED_COLLECTION],
    endpoint: FIREHOSE_URL,
    cursor: cursor,
    ws: WebSocket,
  });

  jetstream.on('open', () => {
    logger.info(
      `Connected to Jetstream at ${FIREHOSE_URL} with cursor ${jetstream.cursor} (${epochUsToDateTime(jetstream.cursor!)})`,
    );
    cursorUpdateInterval = setInterval(() => {
      if (jetstream.cursor) {
        logger.info(`Cursor updated to: ${jetstream.cursor} (${epochUsToDateTime(jetstream.cursor)})`);
        fs.writeFile('cursor.txt', jetstream.cursor.toString(), (err) => {
          if (err) logger.error(err);
        });
      }

      // Update cache size metric
      const stats = getCacheStats();
      cacheSize.set(stats.totalEntries);
    }, CURSOR_UPDATE_INTERVAL);
  });

  jetstream.on('close', () => {
    clearInterval(cursorUpdateInterval);
    logger.info('Jetstream connection closed.');
  });

  jetstream.on('error', (error) => {
    logger.error(`Jetstream error: ${error.message}`);
  });

  // Create processing queue
  const processingQueue = new ProcessingQueue(
    MAX_QUEUE_SIZE,
    async (event: CommitCreateEvent<'app.bsky.feed.post'>) => {
      try {
        const labelsToApply = await processPostImages(event);

        if (labelsToApply.length > 0) {
          const postUri = `at://${event.did}/${WANTED_COLLECTION}/${event.commit.rkey}`;
          await labelPost(postUri, labelsToApply);
          logger.info(`Labeled post ${postUri} with: ${labelsToApply.join(', ')}`);
        }
      } catch (error) {
        logger.error(`Error processing post ${event.commit.rkey}: ${error}`);
      }
    },
  );

  jetstream.onCreate(WANTED_COLLECTION, async (event: CommitCreateEvent<typeof WANTED_COLLECTION>) => {
    // Check if post has images first (quick check)
    if (!hasImages(event.commit?.record)) {
      return;
    }

    // If PROCESS_ALL_POSTS is true, process everything
    if (PROCESS_ALL_POSTS) {
      processingQueue.enqueue(event);
      return;
    }

    // Otherwise, check if the poster has enough followers
    const hasFollowers = await hasEnoughFollowers(event.did);
    if (hasFollowers) {
      processingQueue.enqueue(event);
    }
  });

  const metricsServer = startMetricsServer(METRICS_PORT);

  labelerServer.app.listen({ port: PORT, host: HOST }, (error, address) => {
    if (error) {
      logger.error('Error starting server: %s', error);
    } else {
      logger.info(`Labeler server listening on ${address}`);
    }
  });

  jetstream.start();

  function shutdown() {
    try {
      logger.info('Shutting down gracefully...');
      fs.writeFileSync('cursor.txt', jetstream.cursor!.toString(), 'utf8');
      jetstream.close();
      labelerServer.stop();
      metricsServer.close();
      closeCache();
      logger.info('Shutdown complete');
    } catch (error) {
      logger.error(`Error shutting down gracefully: ${error}`);
      process.exit(1);
    }
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  logger.error(`Fatal error in main: ${error}`);
  process.exit(1);
});
