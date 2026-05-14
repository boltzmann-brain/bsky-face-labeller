# InsightFace Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Python face detection service's `face_recognition` (dlib) backend with InsightFace (ArcFace + RetinaFace) to eliminate false positives.

**Architecture:** The change is entirely inside the Python service. The Node.js service, HTTP API contract (`/detect`, `/health`), reference face directory structure, and pHash caching all stay identical. InsightFace uses a local `python-service/models/` directory (already gitignored) to cache the `buffalo_l` ONNX models (~350MB, downloaded once on first run).

**Tech Stack:** Python 3, InsightFace (`buffalo_l` — RetinaFace detector + ArcFace ResNet-50), onnxruntime (CPU), Flask, NumPy, Pillow

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `python-service/requirements.txt` | Swap `face-recognition` → `insightface` + `onnxruntime` |
| Create | `python-service/test_face_service.py` | Python tests for embedding extraction and same-person similarity |
| Rewrite | `python-service/face_service.py` | InsightFace-based detection and recognition |
| Modify | `package.json` | Remove dead face-api, TensorFlow, canvas deps |
| Delete | `src/download-models.ts` | Legacy script with no callers |

---

## Task 1: Write Failing Tests

**Files:**
- Create: `python-service/test_face_service.py`

- [ ] **Step 1: Write the test file**

Create `python-service/test_face_service.py`:

```python
#!/usr/bin/env python3
"""
Tests for InsightFace-based face detection service.
Run from python-service/: python test_face_service.py
Requires reference-faces/trumpface/ with at least 2 images.
"""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))

from face_service import REFERENCE_FACES_DIR, get_face_embedding  # noqa: E402
from PIL import Image  # noqa: E402


def test_get_face_embedding_returns_normalized_vector():
    """get_face_embedding returns a 512-dim L2-normalized vector for a face image."""
    reference_dir = os.path.join(REFERENCE_FACES_DIR, 'trumpface')
    image_files = sorted(f for f in os.listdir(reference_dir) if f.endswith(('.jpg', '.jpeg', '.png')))
    assert image_files, f"No images found in {reference_dir}"

    image_path = os.path.join(reference_dir, image_files[0])
    image_array = np.array(Image.open(image_path).convert('RGB'))

    embedding = get_face_embedding(image_array)
    assert embedding is not None, "Expected embedding, got None"
    assert embedding.shape == (512,), f"Expected (512,), got {embedding.shape}"

    magnitude = float(np.linalg.norm(embedding))
    assert abs(magnitude - 1.0) < 0.01, f"Expected magnitude ~1.0, got {magnitude:.4f}"
    print(f"PASS: embedding shape={embedding.shape}, magnitude={magnitude:.4f}")


def test_same_person_embeddings_have_high_cosine_similarity():
    """Two different images of the same person have cosine similarity >= 0.4."""
    reference_dir = os.path.join(REFERENCE_FACES_DIR, 'trumpface')
    image_files = sorted(f for f in os.listdir(reference_dir) if f.endswith(('.jpg', '.jpeg', '.png')))
    assert len(image_files) >= 2, f"Need >= 2 images, found {len(image_files)}"

    embeddings = []
    for image_file in image_files[:2]:
        image_array = np.array(Image.open(os.path.join(reference_dir, image_file)).convert('RGB'))
        emb = get_face_embedding(image_array)
        assert emb is not None, f"No face found in {image_file}"
        embeddings.append(emb)

    similarity = float(np.dot(embeddings[0], embeddings[1]))
    assert similarity >= 0.4, f"Expected similarity >= 0.4, got {similarity:.3f}"
    print(f"PASS: same-person similarity = {similarity:.3f}")


if __name__ == '__main__':
    print("Running InsightFace service tests...\n")
    test_get_face_embedding_returns_normalized_vector()
    test_same_person_embeddings_have_high_cosine_similarity()
    print("\nAll tests passed.")
```

- [ ] **Step 2: Run the tests — confirm they fail**

```bash
cd python-service && python test_face_service.py
```

Expected failure:
```
ImportError: cannot import name 'get_face_embedding' from 'face_service'
```

(The current `face_service.py` has no `get_face_embedding` function.)

- [ ] **Step 3: Commit the test file**

```bash
git add python-service/test_face_service.py
git commit -m "test: add InsightFace service tests (currently failing)"
```

---

## Task 2: Update Python Dependencies

**Files:**
- Modify: `python-service/requirements.txt`

- [ ] **Step 1: Update requirements.txt**

Replace the contents of `python-service/requirements.txt` with:

```
flask
insightface
onnxruntime
numpy
Pillow
```

- [ ] **Step 2: Install the new dependencies**

```bash
cd python-service && pip install -r requirements.txt
```

Expected: packages install successfully. `insightface` and `onnxruntime` install without needing cmake or a compiler (unlike `face-recognition` which requires dlib).

If `face-recognition` is already installed in your environment, uninstall it:
```bash
pip uninstall face-recognition dlib -y
```

- [ ] **Step 3: Verify insightface is importable**

```bash
python -c "from insightface.app import FaceAnalysis; print('OK')"
```

Expected:
```
OK
```

- [ ] **Step 4: Run tests — confirm they still fail (with new error)**

```bash
cd python-service && python test_face_service.py
```

Expected failure: the `import face_recognition` line in the old `face_service.py` now raises `ModuleNotFoundError`. This is expected — the implementation hasn't been updated yet.

- [ ] **Step 5: Commit**

```bash
git add python-service/requirements.txt
git commit -m "chore: swap face-recognition for insightface + onnxruntime"
```

---

## Task 3: Rewrite face_service.py with InsightFace

**Files:**
- Rewrite: `python-service/face_service.py`

- [ ] **Step 1: Replace face_service.py**

Replace the entire contents of `python-service/face_service.py` with:

```python
#!/usr/bin/env python3
"""
Face Detection Microservice

Provides face detection and recognition API for the Bluesky labeler.
Uses InsightFace (ArcFace + RetinaFace) for high-accuracy face recognition.
"""

import io
import logging
import os

import numpy as np
from flask import Flask, jsonify, request
from insightface.app import FaceAnalysis
from PIL import Image

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

REFERENCE_FACES_DIR = os.path.join(os.path.dirname(__file__), '..', 'reference-faces')
MODELS_DIR = os.path.join(os.path.dirname(__file__), 'models')
SIMILARITY_THRESHOLD = float(os.getenv('FACE_CONFIDENCE_THRESHOLD', '0.4'))
MAX_FACES_TO_PROCESS = int(os.getenv('MAX_FACES_TO_PROCESS', '50'))

# {person_name: [512-dim L2-normalized numpy arrays]}
reference_embeddings: dict[str, list[np.ndarray]] = {}

face_analyzer = FaceAnalysis(
    name='buffalo_l',
    root=MODELS_DIR,
    providers=['CPUExecutionProvider'],
)
face_analyzer.prepare(ctx_id=0, det_size=(640, 640))


def get_face_embedding(image_array: np.ndarray) -> np.ndarray | None:
    """Return the 512-dim ArcFace embedding for the largest detected face, or None."""
    faces = face_analyzer.get(image_array)
    if not faces:
        return None
    largest = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
    return largest.embedding


def load_reference_faces() -> None:
    """Load all reference face embeddings from the reference-faces directory."""
    logger.info(f"Loading reference faces from {REFERENCE_FACES_DIR}...")

    if not os.path.exists(REFERENCE_FACES_DIR):
        logger.warning(f"Reference faces directory not found: {REFERENCE_FACES_DIR}")
        return

    for person_name in sorted(os.listdir(REFERENCE_FACES_DIR)):
        person_dir = os.path.join(REFERENCE_FACES_DIR, person_name)
        if not os.path.isdir(person_dir):
            continue

        logger.info(f"Loading reference faces for {person_name}...")
        embeddings: list[np.ndarray] = []

        for image_file in sorted(os.listdir(person_dir)):
            if not image_file.lower().endswith(('.jpg', '.jpeg', '.png')):
                continue

            image_path = os.path.join(person_dir, image_file)
            try:
                pil_image = Image.open(image_path).convert('RGB')
                embedding = get_face_embedding(np.array(pil_image))
                if embedding is not None:
                    embeddings.append(embedding)
                    logger.info(f"  ✓ Loaded {person_name}/{image_file}")
                else:
                    logger.warning(f"  ✗ No face found in {person_name}/{image_file}")
            except Exception as e:
                logger.error(f"  ✗ Error loading {person_name}/{image_file}: {e}")

        if embeddings:
            reference_embeddings[person_name] = embeddings
            logger.info(f"Loaded {len(embeddings)} face embeddings for {person_name}")
        else:
            logger.warning(f"No valid face embeddings loaded for {person_name}")

    logger.info(f"Total people loaded: {len(reference_embeddings)}")


@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'healthy',
        'people_loaded': list(reference_embeddings.keys()),
        'total_encodings': sum(len(embs) for embs in reference_embeddings.values()),
    })


@app.route('/detect', methods=['POST'])
def detect_faces():
    if 'image' not in request.files:
        return jsonify({'error': 'No image provided'}), 400

    try:
        image_bytes = request.files['image'].read()
        image_array = np.array(Image.open(io.BytesIO(image_bytes)).convert('RGB'))

        faces = face_analyzer.get(image_array)

        if not faces:
            logger.info("No faces detected in image")
            return jsonify({'matches': []})

        logger.info(f"Detected {len(faces)} face(s) in image")

        if len(faces) > MAX_FACES_TO_PROCESS:
            logger.warning(f"Skipping image with {len(faces)} faces (max: {MAX_FACES_TO_PROCESS})")
            return jsonify({'matches': [], 'skipped': True, 'reason': 'too_many_faces'})

        matches = []
        for face in faces:
            face_emb = face.embedding
            best_person = None
            best_similarity = -1.0

            for person_name, ref_embeddings_list in reference_embeddings.items():
                # Cosine similarity: dot product of L2-normalized vectors
                person_best = max(float(np.dot(face_emb, ref_emb)) for ref_emb in ref_embeddings_list)
                if person_best > best_similarity:
                    best_similarity = person_best
                    best_person = person_name

            if best_person and best_similarity >= SIMILARITY_THRESHOLD:
                matches.append({'person': best_person, 'confidence': round(best_similarity, 3)})
                logger.info(f"Match found: {best_person} (similarity: {best_similarity:.3f})")

        # Deduplicate: one entry per person, keep highest confidence
        unique_matches: dict[str, dict] = {}
        for match in matches:
            person = match['person']
            if person not in unique_matches or match['confidence'] > unique_matches[person]['confidence']:
                unique_matches[person] = match

        return jsonify({'matches': list(unique_matches.values())})

    except Exception as e:
        logger.error(f"Error processing image: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    load_reference_faces()
    port = int(os.getenv('PORT', '5000'))
    app.run(host='0.0.0.0', port=port, debug=False)
```

- [ ] **Step 2: Run the tests — confirm they pass**

```bash
cd python-service && python test_face_service.py
```

On first run, InsightFace downloads the `buffalo_l` models (~350MB) into `python-service/models/`. This takes a minute. Subsequent runs are instant.

Expected output:
```
Running InsightFace service tests...

PASS: embedding shape=(512,), magnitude=1.0000
PASS: same-person similarity = 0.XXX
    
All tests passed.
```

If `same-person similarity` is below `0.4`: the reference photos may be too low-quality or too few. Add more clear, well-lit photos of the person's face to `reference-faces/trumpface/`.

- [ ] **Step 3: Verify the health endpoint**

In one terminal:
```bash
cd python-service && python face_service.py
```

In another:
```bash
curl http://localhost:5000/health
```

Expected:
```json
{
  "people_loaded": ["trumpface"],
  "status": "healthy",
  "total_encodings": 6
}
```

- [ ] **Step 4: Verify the detect endpoint with a known image**

```bash
curl -X POST http://localhost:5000/detect \
  -F "image=@reference-faces/trumpface/001.jpg"
```

Expected: a match with confidence >= 0.4:
```json
{"matches": [{"confidence": 0.XXX, "person": "trumpface"}]}
```

- [ ] **Step 5: Tune the threshold if needed**

If you see false positives in production, raise `FACE_CONFIDENCE_THRESHOLD` in `.env`:
- `0.4` — balanced (default)
- `0.45` — stricter
- `0.5` — very strict

If legitimate Trump images are missed, lower toward `0.35`.

- [ ] **Step 6: Commit**

```bash
git add python-service/face_service.py
git commit -m "feat: migrate face detection to InsightFace (ArcFace + RetinaFace)"
```

---

## Task 4: Remove Legacy Node.js Face-API Dependencies

**Files:**
- Modify: `package.json`
- Delete: `src/download-models.ts`

- [ ] **Step 1: Remove dead packages from package.json**

In `package.json`, remove these three entries from `dependencies`:

```json
"@tensorflow/tfjs-node": "^4.20.0",
"@vladmandic/face-api": "^1.7.13",
"canvas": "^2.11.2",
```

After removal the `dependencies` block should contain no face-api or TensorFlow entries.

- [ ] **Step 2: Delete the legacy download-models script**

```bash
rm src/download-models.ts
```

- [ ] **Step 3: Remove the download-models npm script from package.json**

In `package.json`, remove this line from `scripts`:

```json
"download-models": "npx tsx src/download-models.ts",
```

- [ ] **Step 4: Reinstall Node.js dependencies**

```bash
npm install
```

Expected: installs without errors. The `node_modules/@vladmandic`, `node_modules/@tensorflow`, and `node_modules/canvas` directories should be gone.

- [ ] **Step 5: Verify the Node.js service still starts**

```bash
npm run dev
```

Expected: service starts, connects to Jetstream, logs `Python service healthy`. No import errors.

Stop the service with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: remove legacy face-api, TensorFlow, and canvas dependencies"
```

---

## Post-Migration Checklist

- [ ] Python service passes both tests (`python test_face_service.py`)
- [ ] `/health` returns correct `people_loaded` and `total_encodings`
- [ ] `/detect` with a Trump image returns a match
- [ ] `/detect` with a non-Trump face returns `{"matches": []}`
- [ ] Node.js service starts without errors
- [ ] `FACE_CONFIDENCE_THRESHOLD` tuned to minimize false positives (start at `0.4`, raise if needed)

## GPU Upgrade (Future)

When switching to a GPU DigitalOcean droplet:
1. `pip uninstall onnxruntime && pip install onnxruntime-gpu`
2. In `face_service.py`, change `providers=['CPUExecutionProvider']` → `providers=['CUDAExecutionProvider']`
3. No other changes needed.
