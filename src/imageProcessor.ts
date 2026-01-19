import { CommitCreateEvent } from '@skyware/jetstream';

import { MAX_IMAGE_PROCESSING_TIME } from './config.js';
import { detectFaces, downloadImageBlob } from './faceDetection.js';
import logger from './logger.js';
import { BlobRef } from './types.js';

/**
 * Check if a post record has images
 */
export function hasImages(record: any): boolean {
  return (
    record?.embed?.$type === 'app.bsky.embed.images' &&
    Array.isArray(record.embed.images) &&
    record.embed.images.length > 0
  );
}

/**
 * Process post images and return labels to apply
 */
export async function processPostImages(
  event: CommitCreateEvent<'app.bsky.feed.post'>,
): Promise<string[]> {
  const record = event.commit?.record;

  if (!record || !hasImages(record)) {
    return [];
  }

  const imageBlobs = extractImageBlobs(record);
  const did = event.did;

  if (imageBlobs.length === 0) {
    logger.warn(`Post has embed.images but no valid blobs found`);
    return [];
  }

  logger.info(`Processing ${imageBlobs.length} image(s) from post by ${did}`);

  const detectedPeople = new Set<string>();

  for (let i = 0; i < imageBlobs.length; i++) {
    const blob = imageBlobs[i];

    try {
      const matches = await processImageWithTimeout(did, blob, i);

      for (const match of matches) {
        detectedPeople.add(match.person);
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'Timeout') {
        logger.warn(`Image ${i + 1} processing timeout, skipping`);
      } else {
        logger.error(`Error processing image ${i + 1}: ${error}`);
      }
    }
  }

  return Array.from(detectedPeople);
}

/**
 * Process a single image with timeout protection
 */
async function processImageWithTimeout(
  did: string,
  blob: BlobRef,
  index: number,
): Promise<Array<{ person: string; confidence: number }>> {
  return Promise.race([
    processSingleImage(did, blob, index),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), MAX_IMAGE_PROCESSING_TIME),
    ),
  ]);
}

/**
 * Process a single image blob
 */
async function processSingleImage(
  did: string,
  blob: BlobRef,
  index: number,
): Promise<Array<{ person: string; confidence: number }>> {
  const startTime = Date.now();

  try {
    // Download the image
    logger.info(`Downloading image ${index + 1}...`);
    const imageBuffer = await downloadImageBlob(did, blob);
    const downloadTime = Date.now() - startTime;
    logger.info(`Image ${index + 1} downloaded (${downloadTime}ms, ${(blob.size / 1024).toFixed(1)}KB)`);

    // Detect faces
    logger.info(`Detecting faces in image ${index + 1}...`);
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

    return matches;
  } catch (error) {
    logger.error(`Failed to process image ${index + 1}: ${error}`);
    throw error;
  }
}

/**
 * Extract image blob references from post embed
 */
function extractImageBlobs(record: any): BlobRef[] {
  if (!hasImages(record)) {
    return [];
  }

  const blobs: BlobRef[] = [];

  for (const img of record.embed.images) {
    if (img.image && img.image.$type === 'blob' && img.image.ref) {
      blobs.push({
        $type: img.image.$type,
        ref: img.image.ref,
        mimeType: img.image.mimeType || 'image/jpeg',
        size: img.image.size || 0,
      });
    }
  }

  return blobs;
}
