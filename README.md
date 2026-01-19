# Bluesky Face Detection Labeler

This is a Bluesky labeler that automatically detects faces of public figures in post images and applies labels to those posts.

**Example**: When someone posts an image containing Donald Trump, the labeler automatically detects his face and applies the "trump" label to that post. Users who subscribe to this labeler will see these labels on posts in their feeds.

**Starting scope**: Currently configured to detect Trump as a proof of concept. Easy to expand to other public figures.

**This project requires familiarity with TypeScript, the command line, and Linux.**

## Support My Work

If you find this project helpful, please consider supporting my work:

[![Ko-fi](https://img.shields.io/badge/Ko--fi-F16061?style=for-the-badge&logo=ko-fi&logocolor=white)](https://ko-fi.com/aliceisjustplaying)
[![GitHub Sponsors](https://img.shields.io/badge/sponsor-30363D?style=for-the-badge&logo=GitHub-Sponsors&logoColor=#white)](https://github.com/sponsors/aliceisjustplaying)

## Prerequisites

- [Node.js](https://nodejs.org/) v22.11.0 (LTS) for the runtime
- npm (comes with Node.js) for package management
- ~50MB disk space for face detection models and reference images
- 4+ CPU cores recommended for face detection
- ~1GB RAM for models and processing

## Setup

### 1. Initial Setup

Clone the repo and install dependencies:

```bash
git clone <your-repo-url>
cd bsky-face-labeller
npm install
```

### 2. Setup Labeler Account

Run the Skyware labeler setup to convert an existing Bluesky account into a labeler:

```bash
npx @skyware/labeler setup
```

You can exit after converting the account; there's no need to add the labels with the wizard. We'll do that from code.

### 3. Configure Environment

Copy the `.env.example` file to `.env` and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` with your labeler credentials:

```env
DID=did:plc:xxx
SIGNING_KEY=xxx
BSKY_IDENTIFIER=xxx
BSKY_PASSWORD=xxx
HOST=127.0.0.1
PORT=4100
METRICS_PORT=4101
FIREHOSE_URL=wss://jetstream1.us-east.bsky.network/subscribe
CURSOR_UPDATE_INTERVAL=10000

# Face detection configuration
FACE_CONFIDENCE_THRESHOLD=0.6
MAX_IMAGE_PROCESSING_TIME=10000
MAX_QUEUE_SIZE=100
PROCESS_ALL_POSTS=false
```

**Important**: Set `PROCESS_ALL_POSTS=false` initially to avoid overwhelming your server. You can enable it later after testing.

### 4. Download Face Detection Models

Download the required face-api.js models (~12MB):

```bash
npm run download-models
```

This will download models to the `models/` directory.

### 5. Add Reference Face Images

Add 5-10 clear photos of Trump's face to the `reference-faces/trump/` directory:

```bash
# Example: Download images to reference-faces/trump/
# Name them 001.jpg, 002.jpg, 003.jpg, etc.
```

See `reference-faces/README.md` for detailed guidelines on image quality and requirements.

**You need to provide these images yourself.** Search for high-quality, well-lit photos of Trump's face from different angles.

### 6. Publish Labels

Run the label setup script to publish your label definitions to Bluesky:

```bash
npm run set-labels
```

This creates the "trump" label in the Bluesky labeler system.

### 7. Create Cursor File

A `cursor.txt` file containing the time in microseconds needs to be present. It will be created automatically on first run.

The server connects to [Jetstream](https://github.com/bluesky-social/jetstream), which provides a WebSocket endpoint that emits ATProto events in JSON. There are [many public instances](https://github.com/bluesky-social/jetstream/blob/main/README.md#public-instances) available:

| Hostname                          | Region  |
| --------------------------------- | ------- |
| `jetstream1.us-east.bsky.network` | US-East |
| `jetstream2.us-east.bsky.network` | US-East |
| `jetstream1.us-west.bsky.network` | US-West |
| `jetstream2.us-west.bsky.network` | US-West |

The server needs to be reachable outside your local network using the URL you provided during the account setup (typically using a reverse proxy such as [Caddy](https://caddyserver.com/)):

```Caddyfile
labeler.example.com {
	reverse_proxy 127.0.0.1:4100
}
```

Metrics are exposed on the defined `METRICS_PORT` for [Prometheus](https://prometheus.io/). [This dashboard](https://grafana.com/grafana/dashboards/11159-nodejs-application-dashboard/) can be used to visualize the metrics in [Grafana](https://grafana.com/grafana/).

## Running the Labeler

Start the labeler:

```bash
npm run start
```

You should see logs indicating:
1. Face detection models loading
2. Reference faces being loaded
3. Connection to Jetstream
4. "Face detection initialization complete"

You can check that the labeler is reachable by checking the `/xrpc/com.atproto.label.queryLabels` endpoint of your labeler's server. A new, empty labeler returns `{"cursor":"0","labels":[]}`.

## Testing

With `PROCESS_ALL_POSTS=false` (default), the labeler won't process any posts yet. To test:

1. Temporarily set `PROCESS_ALL_POSTS=true` in your `.env`
2. Restart the labeler
3. Post an image containing Trump to Bluesky (or wait for someone else to)
4. Watch the logs for face detection results
5. Check if the label was applied

**Warning**: Setting `PROCESS_ALL_POSTS=true` will process ALL posts with images on the firehose, which can be 200-600 posts/second during peak times. Only enable this if your server can handle it, or add filtering logic first.

## Adding More Public Figures

Once Trump detection is working, you can add more people:

1. Create a new directory in `reference-faces/`:
   ```bash
   mkdir reference-faces/biden
   ```

2. Add 5-10 clear photos of that person to the directory (name them `001.jpg`, `002.jpg`, etc.)

3. Add the label to `src/constants.ts`:
   ```typescript
   {
     rkey: '',
     identifier: 'biden',
     locales: [
       {
         lang: 'en',
         name: 'Joe Biden',
         description: 'This post contains an image of Joe Biden',
       },
     ],
   }
   ```

4. Publish the new label:
   ```bash
   npm run set-labels
   ```

5. Restart the labeler to load the new reference faces

## Configuration

### Environment Variables

- `FACE_CONFIDENCE_THRESHOLD` (default: 0.6) - Minimum confidence for face match (0.0-1.0). Higher = more strict, fewer false positives.
- `MAX_IMAGE_PROCESSING_TIME` (default: 10000) - Maximum time in ms to process a single image before timeout.
- `MAX_QUEUE_SIZE` (default: 100) - Maximum number of posts in processing queue. Posts are dropped when queue is full.
- `PROCESS_ALL_POSTS` (default: false) - Whether to process all posts with images. Set to `false` to avoid overwhelming your server.

### Performance Tuning

If you're getting too many false positives:
- Increase `FACE_CONFIDENCE_THRESHOLD` to 0.7 or 0.8
- Add more varied reference images

If you're missing correct detections:
- Decrease `FACE_CONFIDENCE_THRESHOLD` to 0.5
- Add more reference images with similar angles/lighting

If processing is too slow:
- Reduce `MAX_IMAGE_PROCESSING_TIME`
- Add more CPU cores
- Process only specific posts (add filtering logic)

## Monitoring

Metrics are available at `http://localhost:4101/metrics`:

- `posts_processed_total` - Total posts processed
- `faces_detected_total` - Total faces detected (by person)
- `image_processing_duration_seconds` - Processing time histogram
- `processing_queue_size` - Current queue size
- `processing_errors_total` - Error counts

## Troubleshooting

### No faces detected
- Check reference images are high quality and faces are clearly visible
- Review logs for face detection errors
- Lower confidence threshold

### False positives
- Increase confidence threshold
- Add more reference images for better accuracy
- Check reference images don't include other people

### High CPU usage
- Set `PROCESS_ALL_POSTS=false`
- Add filtering logic to process fewer posts
- Reduce `MAX_QUEUE_SIZE`

### Out of memory
- Reduce `MAX_QUEUE_SIZE`
- Add more RAM
- Process fewer posts at once

## Credits

- [alice](https://bsky.app/profile/did:plc:by3jhwdqgbtrcc7q4tkkv3cf), creator of the [Zodiac Sign Labels](https://github.com/aliceisjustplaying/zodiacsigns)
- [Juliet](https://bsky.app/profile/did:plc:b3pn34agqqchkaf75v7h43dk), author of the [Pronouns labeler](https://github.com/notjuliet/pronouns-bsky), whose code my labelers were originally based on
- [futur](https://bsky.app/profile/did:plc:uu5axsmbm2or2dngy4gwchec), creator of the [skyware libraries](https://skyware.js.org/) which make it easier to build things for Bluesky
