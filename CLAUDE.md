# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Bluesky labeler that automatically detects faces of public figures in post images and applies labels to those posts. The system uses a hybrid architecture:
- **Node.js TypeScript service**: Connects to Bluesky's Jetstream firehose, manages labeling, and orchestrates processing
- **Python microservice**: Handles face detection and recognition using the face_recognition library

## Architecture

### Two-Service Architecture

The system consists of two independent services that communicate via HTTP:

1. **Node.js Labeler Service** (port 4100)
   - Consumes the Bluesky Jetstream WebSocket firehose
   - Maintains cursor state for reliable message processing
   - Downloads post images from ATProto
   - Sends images to Python service for face detection
   - Applies labels to posts based on detection results
   - Exposes metrics on port 4101

2. **Python Face Detection Service** (port 5001)
   - Flask HTTP server
   - Loads reference face encodings on startup from `reference-faces/` directory
   - Provides `/detect` endpoint that accepts image uploads
   - Uses `face_recognition` library (built on dlib) for detection and matching
   - Returns matched people with confidence scores

### Data Flow

1. Post created on Bluesky → Jetstream emits event
2. Node service receives event via WebSocket
3. If post has images and passes filters → added to processing queue
4. Queue worker downloads image from ATProto blob storage
5. Image resized to 1024x1024 and sent to Python service
6. Python service detects faces and matches against reference encodings
7. Node service receives matches and applies corresponding labels via Skyware labeler
8. Labels propagate to Bluesky users who subscribe to the labeler

### Key Files

- `src/main.ts` - Entry point, Jetstream connection, event handling
- `src/faceDetection.ts` - Interface to Python service, image downloading
- `src/imageProcessor.ts` - Image processing pipeline, timeout handling
- `src/label.ts` - Skyware labeler server, label application
- `src/queue.ts` - Processing queue with concurrency control
- `src/constants.ts` - Label definitions (add new people here)
- `python-service/face_service.py` - Face detection microservice

## Common Development Commands

### Running the Application

```bash
npm run start          # Start labeler (production)
npm run dev            # Start labeler with auto-reload
```

**Note**: You must start the Python service separately:
```bash
cd python-service
python3 face_service.py
```

For VPS deployment, use the management scripts:
```bash
./scripts/start-services.sh    # Start both services via PM2
./scripts/status.sh            # Check service health
./scripts/stop-services.sh     # Stop both services
./scripts/restart-services.sh  # Restart both services
./scripts/update.sh            # Pull updates and restart
```

### Setup and Configuration

```bash
npm run set-labels     # Publish label definitions to Bluesky
npm run download-models # Download face-api.js models (legacy, not used)
```

### Code Quality

```bash
npm run lint           # Check linting
npm run lint:fix       # Fix linting issues
npm run format         # Format code with Prettier
```

### Development Tools

```bash
npx tsx <file.ts>      # Run any TypeScript file directly
```

## Configuration

### Environment Variables

All configuration is in `.env`. Key variables:

**Bluesky Credentials** (required):
- `DID` - Labeler DID from account setup
- `SIGNING_KEY` - Signing key from account setup
- `BSKY_IDENTIFIER` - Bluesky handle
- `BSKY_PASSWORD` - App password

**Processing Controls**:
- `PROCESS_ALL_POSTS` - Set to `false` to disable processing (default)
- `FACE_CONFIDENCE_THRESHOLD` - Minimum confidence for matches (0.0-1.0, default 0.6)
- `MAX_IMAGE_PROCESSING_TIME` - Timeout per image in ms (default 10000)
- `MAX_QUEUE_SIZE` - Maximum concurrent processing queue (default 100)

**Services**:
- `PORT` - Labeler server port (default 4100)
- `METRICS_PORT` - Prometheus metrics port (default 4101)
- `FIREHOSE_URL` - Jetstream WebSocket URL
- `PYTHON_SERVICE_URL` - Python service URL (default http://localhost:5001)

### Reference Face Structure

Reference faces are organized by person in `reference-faces/`:
```
reference-faces/
  trump/
    001.jpg
    002.jpg
    ...
  biden/
    001.jpg
    ...
```

The Python service automatically loads all subdirectories as people, so:
- Directory name = label identifier (must match `constants.ts`)
- Each directory should contain 5-10 clear face photos
- Supports .jpg, .jpeg, .png formats

## Adding New Public Figures

1. Create directory: `mkdir reference-faces/<person-name>`
2. Add 5-10 clear face photos to the directory
3. Add label definition to `src/constants.ts`:
   ```typescript
   {
     rkey: '',
     identifier: '<person-name>',  // Must match directory name
     locales: [{
       lang: 'en',
       name: 'Display Name',
       description: 'This post contains an image of Display Name'
     }]
   }
   ```
4. Run `npm run set-labels` to publish the new label
5. Restart both services to load new reference faces

## Important Implementation Details

### Cursor Management

The application maintains a cursor in `cursor.txt` that tracks the last processed Jetstream event. This enables:
- Resuming from the same position after restart
- No duplicate processing
- No missed events

The cursor is updated every `CURSOR_UPDATE_INTERVAL` ms and on shutdown.

### Processing Queue

Uses a custom `ProcessingQueue` class to:
- Limit concurrent processing to prevent overload
- Drop posts when queue is full (prevents unbounded memory growth)
- Process asynchronously without blocking Jetstream connection

### Image Processing Pipeline

1. Post validation (has images, passes filters)
2. Queue enqueue with overflow protection
3. Image download with retry and exponential backoff
4. **Perceptual hash computation** (using sharp-phash)
5. **Cache lookup** - check if image has been processed before
6. Image resize to 1024x1024 (reduces Python service load) - only if cache miss
7. Face detection via HTTP POST to Python service - only if cache miss
8. **Cache storage** - store detection results for future lookups
9. Label application via Skyware labeler

Each step has timeout protection to prevent hanging.

### Python Service Communication

The Node service expects the Python service to:
- Be running on startup (initialization check via `/health`)
- Respond to POST `/detect` with multipart/form-data image
- Return JSON: `{ matches: [{ person: string, confidence: number }] }`

If the Python service is down, the Node service will fail to start.

### Label Application

Labels are applied using the Skyware labeler library, which:
- Creates signed label records
- Stores them in an in-memory database
- Exposes them via XRPC endpoints for Bluesky to query
- Requires DID and SIGNING_KEY from account setup

### Perceptual Hash Caching

To avoid re-processing duplicate or reposted images, the system uses perceptual hashing (pHash):

**How it works:**
- Each image is hashed using the `sharp-phash` library before face detection
- The hash is a 64-bit fingerprint that remains similar even if the image is slightly modified (cropped, filtered, resized)
- Results (detected people or empty array) are stored in SQLite database (`image_cache` table)
- On subsequent encounters, the cached result is returned immediately without calling the Python service

**Benefits:**
- **Massive CPU savings** - Reposted images skip face detection entirely
- **Faster processing** - Cache hits return in <10ms vs 100-500ms for detection
- **Python service load reduction** - Fewer HTTP requests to the face detection service
- **Handles image variations** - Detects near-duplicates even with minor edits

**Database schema:**
```sql
CREATE TABLE image_cache (
  phash TEXT NOT NULL UNIQUE,           -- 64-bit perceptual hash
  detected_people TEXT NOT NULL,        -- JSON array of detected people
  created_at DATETIME,                  -- First time seen
  last_seen_at DATETIME,                -- Most recent encounter
  seen_count INTEGER                    -- How many times encountered
);
```

**Cache behavior:**
- Empty results (no faces detected) are cached to avoid re-processing memes/non-face images
- Each cache hit increments `seen_count` and updates `last_seen_at`
- Cache persists across restarts (stored in SQLite)
- Cache statistics logged on startup and available via metrics

**Key files:**
- `src/imageCache.ts` - Cache operations (compute hash, get/set results, stats)
- `src/db-setup.ts` - Database schema initialization
- `test-phash-cache.ts` - Test suite for cache functionality

## Deployment Notes

### VPS Deployment

Use the provided deployment scripts in `scripts/`:
- `deploy.sh` - Initial setup (installs dependencies, clones repo)
- `start-services.sh` - Start both services with PM2
- `status.sh` - Health check both services
- `update.sh` - Pull updates and restart

Services run under PM2 for:
- Auto-restart on crash
- Log management
- Process monitoring
- Startup on server reboot

### Performance Characteristics

Face detection is CPU and memory intensive:
- Expect ~100-500ms per image for detection
- Each reference person adds ~5-10 encodings to compare
- Peak Bluesky firehose: 200-600 posts/second with images
- Recommended: 4GB RAM, 2+ CPU cores

Use `PROCESS_ALL_POSTS=false` initially to avoid overwhelming your server. Add filtering logic (language, engagement, etc.) before enabling full processing.

### Monitoring

Prometheus metrics at `http://localhost:4101/metrics`:
- `posts_processed_total` - Total posts processed
- `faces_detected_total` - Faces detected by person
- `image_processing_duration_seconds` - Processing time histogram
- `processing_queue_size` - Current queue depth
- `processing_errors_total` - Error counts
- `image_cache_hits_total` - Number of cache hits (duplicate images)
- `image_cache_misses_total` - Number of cache misses (new images)
- `image_cache_size` - Total entries in cache database

Python service health: `http://localhost:5001/health`

## Testing Face Detection

To test detection without processing the full firehose:

1. Use the test scripts: `test-face-detection.ts`, `test-face-detection2.ts`, etc.
2. Run with: `npx tsx test-face-detection.ts`
3. These scripts test the Python service directly with local images

Or temporarily set `PROCESS_ALL_POSTS=true` and post a test image to Bluesky.

## Code Patterns

### Error Handling

All async operations use try/catch with logger output. The queue worker catches errors to prevent one bad post from crashing the service.

### Logging

Uses `pino` logger with structured logging. All log statements include context (image number, DID, timing).

### TypeScript Patterns

- ES modules (`.js` extensions in imports)
- Strict null checks
- Type definitions in `src/types.ts`
- Environment config validated in `src/config.ts`

### Python Service

- Flask with synchronous endpoints (no async needed)
- In-memory reference encoding storage
- Numpy arrays for face_recognition library
- Environment variables for configuration
