import express from 'express';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

import logger from './logger.js';

const register = new Registry();
collectDefaultMetrics({ register });

// Face detection metrics
export const postsProcessed = new Counter({
  name: 'posts_processed_total',
  help: 'Total posts processed for face detection',
  registers: [register],
});

export const facesDetected = new Counter({
  name: 'faces_detected_total',
  help: 'Total faces detected and matched',
  labelNames: ['person'],
  registers: [register],
});

export const processingTime = new Histogram({
  name: 'image_processing_duration_seconds',
  help: 'Time to process images for face detection',
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [register],
});

export const queueSize = new Gauge({
  name: 'processing_queue_size',
  help: 'Current size of the processing queue',
  registers: [register],
});

export const errorRate = new Counter({
  name: 'processing_errors_total',
  help: 'Total processing errors',
  labelNames: ['error_type'],
  registers: [register],
});

const app = express();

app.get('/metrics', (req, res) => {
  register
    .metrics()
    .then((metrics) => {
      res.set('Content-Type', register.contentType);
      res.send(metrics);
    })
    .catch((ex: unknown) => {
      logger.error(`Error serving metrics: ${(ex as Error).message}`);
      res.status(500).end((ex as Error).message);
    });
});

export const startMetricsServer = (port: number, host = '127.0.0.1') => {
  return app.listen(port, host, () => {
    logger.info(`Metrics server is listening on ${host}:${port}`);
  });
};
