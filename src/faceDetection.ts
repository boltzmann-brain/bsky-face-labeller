import axios from 'axios';
import FormData from 'form-data';
import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

import logger from './logger.js';
import { BlobRef, FaceMatch } from './types.js';

// Support multiple Python service URLs for load balancing (comma-separated)
const PYTHON_SERVICE_URLS = (process.env.PYTHON_SERVICE_URL || 'http://localhost:5001')
  .split(',')
  .map((url) => url.trim());
let currentServiceIndex = 0;

// Round-robin selection of Python service
function getNextPythonServiceUrl(): string {
  const url = PYTHON_SERVICE_URLS[currentServiceIndex];
  currentServiceIndex = (currentServiceIndex + 1) % PYTHON_SERVICE_URLS.length;
  return url;
}

// Initialization status
let initialized = false;
let pythonServiceHealthy = false;

/**
 * Initialize face detection (check Python service health)
 */
export async function initializeFaceDetection(): Promise<void> {
  if (initialized) {
    logger.info('Face detection already initialized');
    return;
  }

  logger.info('Checking Python face detection service...');

  try {
    const serviceUrl = PYTHON_SERVICE_URLS[0]; // Check first service for health
    const healthResponse = await axios.get(`${serviceUrl}/health`);
    const health = healthResponse.data as { status: string; people_loaded: string[]; total_encodings: number };

    if (health.status === 'healthy') {
      pythonServiceHealthy = true;
      initialized = true;
      logger.info(`Python service healthy: ${health.people_loaded.length} people, ${health.total_encodings} encodings`);
      logger.info(`Loaded people: ${health.people_loaded.join(', ')}`);
    } else {
      throw new Error('Python service unhealthy');
    }
  } catch (error) {
    logger.error(`Failed to connect to Python face detection service at ${PYTHON_SERVICE_URLS[0]}: ${error}`);
    throw new Error('Face detection initialization failed - Python service not available');
  }
}

/**
 * Load reference faces (handled by Python service on startup)
 */
export async function loadReferenceFaces(): Promise<void> {
  // Python service loads reference faces on startup
  // Just verify it's ready
  if (!pythonServiceHealthy) {
    throw new Error('Python service not healthy');
  }
  logger.info('Reference faces loaded by Python service');
}

/**
 * Detect and recognize faces in an image buffer
 */
export async function detectFaces(imageBuffer: Buffer): Promise<FaceMatch[]> {
  if (!initialized || !pythonServiceHealthy) {
    throw new Error('Face detection not initialized or Python service unavailable');
  }

  try {
    // Resize image before sending to Python service
    const resizedBuffer = await sharp(imageBuffer)
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();

    // Create form data with image
    const formData = new FormData();
    formData.append('image', resizedBuffer, {
      filename: 'image.jpg',
      contentType: 'image/jpeg',
    });

    // Call Python service using axios
    const serviceUrl = getNextPythonServiceUrl();
    const response = await axios.post(`${serviceUrl}/detect`, formData, {
      headers: formData.getHeaders(),
    });

    const result = response.data as { matches: Array<{ person: string; confidence: number }> };

    // Convert to FaceMatch format
    const matches: FaceMatch[] = result.matches.map((match) => ({
      person: match.person,
      confidence: match.confidence,
      boundingBox: {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      },
    }));

    return matches;
  } catch (error) {
    logger.error(`Error detecting faces via Python service: ${error}`);
    throw error;
  }
}

/**
 * Download image blob from ATProto
 */
export async function downloadImageBlob(did: string, blobRef: BlobRef): Promise<Buffer> {
  const cid = blobRef.ref.$link;
  const url = `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${did}&cid=${cid}`;

  return downloadWithRetry(url, 3);
}

/**
 * Download with retry and exponential backoff
 */
async function downloadWithRetry(url: string, maxRetries: number): Promise<Buffer> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await downloadUrl(url);
    } catch (error) {
      if (attempt === maxRetries - 1) {
        throw error;
      }

      const delay = 1000 * Math.pow(2, attempt);
      logger.warn(`Download failed (attempt ${attempt + 1}/${maxRetries}), retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }

  throw new Error('Download failed after retries');
}

/**
 * Download URL to buffer
 */
function downloadUrl(url: string, maxRedirects = 5): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const protocol = url.startsWith('https') ? https : http;

    protocol
      .get(url, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
          const location = response.headers.location;
          if (!location) {
            reject(new Error(`Redirect without location header`));
            return;
          }

          if (maxRedirects <= 0) {
            reject(new Error('Too many redirects'));
            return;
          }

          // Follow redirect
          downloadUrl(location, maxRedirects - 1).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode === 200) {
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => resolve(Buffer.concat(chunks)));
        } else {
          reject(new Error(`HTTP ${response.statusCode}`));
        }
      })
      .on('error', reject);
  });
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get list of loaded reference people
 */
export async function getLoadedPeople(): Promise<string[]> {
  if (!pythonServiceHealthy) {
    return [];
  }

  try {
    const response = await axios.get(`${PYTHON_SERVICE_URLS[0]}/health`);
    const health = response.data as { people_loaded: string[] };
    return health.people_loaded;
  } catch (error) {
    logger.error(`Error getting loaded people: ${error}`);
    return [];
  }
}

/**
 * Check if face detection is initialized
 */
export function isInitialized(): boolean {
  return initialized && pythonServiceHealthy;
}
