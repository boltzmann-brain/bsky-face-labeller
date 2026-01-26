import { CommitCreateEvent } from '@skyware/jetstream';

import logger from './logger.js';

type QueuedEvent = CommitCreateEvent<'app.bsky.feed.post'>;
type EventProcessor = (event: QueuedEvent) => Promise<void>;

export class ProcessingQueue {
  private queue: QueuedEvent[] = [];
  private activeCount = 0;
  private maxQueueSize: number;
  private concurrency: number;
  private processor: EventProcessor;
  private droppedCount = 0;

  constructor(maxQueueSize: number, processor: EventProcessor, concurrency = 2) {
    this.maxQueueSize = maxQueueSize;
    this.processor = processor;
    this.concurrency = concurrency;
  }

  /**
   * Add event to queue
   */
  async enqueue(event: QueuedEvent): Promise<void> {
    if (this.queue.length >= this.maxQueueSize) {
      this.droppedCount++;
      if (this.droppedCount % 10 === 0) {
        logger.warn(`Processing queue full (${this.queue.length}/${this.maxQueueSize}), dropped ${this.droppedCount} posts`);
      }
      return;
    }

    this.queue.push(event);
    // Start multiple workers up to concurrency limit
    while (this.activeCount < this.concurrency && this.queue.length > 0) {
      this.processNext();
    }
  }

  /**
   * Process next event in queue
   */
  private async processNext(): Promise<void> {
    if (this.activeCount >= this.concurrency || this.queue.length === 0) {
      return;
    }

    this.activeCount++;
    const event = this.queue.shift()!;

    try {
      await this.processor(event);
    } catch (error) {
      logger.error(`Queue processing error: ${error}`);
    } finally {
      this.activeCount--;

      // Process next item if queue not empty
      if (this.queue.length > 0) {
        this.processNext();
      }
    }
  }

  /**
   * Get current queue size
   */
  getSize(): number {
    return this.queue.length;
  }

  /**
   * Get dropped events count
   */
  getDroppedCount(): number {
    return this.droppedCount;
  }

  /**
   * Reset dropped count
   */
  resetDroppedCount(): void {
    this.droppedCount = 0;
  }
}
