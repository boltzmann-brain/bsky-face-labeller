import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';

const MODELS_URL = 'https://raw.githubusercontent.com/vladmandic/face-api/master/model';
const MODELS_DIR = path.join(process.cwd(), 'models');

// Models we need for face detection and recognition
const MODELS = [
  // SSD MobileNet V1 for face detection
  'ssd_mobilenetv1_model-weights_manifest.json',
  'ssd_mobilenetv1_model.bin',
  // Face landmarks (68 points)
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model.bin',
  // Face recognition model
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model.bin',
];

async function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (response) => {
        if (response.statusCode === 200) {
          response.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        } else if (response.statusCode === 302 || response.statusCode === 301) {
          // Handle redirects
          file.close();
          fs.unlinkSync(dest);
          if (response.headers.location) {
            downloadFile(response.headers.location, dest).then(resolve).catch(reject);
          } else {
            reject(new Error(`Redirect without location for ${url}`));
          }
        } else {
          file.close();
          fs.unlinkSync(dest);
          reject(new Error(`Failed to download ${url}: ${response.statusCode}`));
        }
      })
      .on('error', (err) => {
        file.close();
        fs.unlinkSync(dest);
        reject(err);
      });
  });
}

async function main() {
  console.log('Face-API Model Downloader');
  console.log('========================\n');

  // Ensure models directory exists
  if (!fs.existsSync(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
    console.log(`Created models directory: ${MODELS_DIR}\n`);
  }

  console.log(`Downloading ${MODELS.length} model files...\n`);

  for (const model of MODELS) {
    const url = `${MODELS_URL}/${model}`;
    const dest = path.join(MODELS_DIR, model);

    // Skip if already exists
    if (fs.existsSync(dest)) {
      console.log(`✓ ${model} (already exists)`);
      continue;
    }

    try {
      process.stdout.write(`  Downloading ${model}...`);
      await downloadFile(url, dest);
      const stats = fs.statSync(dest);
      const sizeKB = (stats.size / 1024).toFixed(2);
      console.log(` ✓ (${sizeKB} KB)`);
    } catch (error) {
      console.log(` ✗ FAILED`);
      console.error(`  Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }

  console.log('\n✓ All models downloaded successfully!');
  console.log(`Models saved to: ${MODELS_DIR}`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
