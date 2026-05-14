# Design: Migrate Face Detection to InsightFace

**Date:** 2026-05-14  
**Status:** Approved  
**Goal:** Replace `face_recognition` (dlib) with InsightFace (ArcFace + RetinaFace) to reduce false positives in the Trump face labeler.

---

## Problem

The Python service uses `face_recognition` (dlib HOG detector + 128-dim ResNet embeddings). This produces too many false positives. Dlib's HOG-based detector and 128-dim embedding space are weaker than modern deep-learning alternatives, and the L2 distance threshold is coarse.

---

## Solution

Replace the detection and recognition backend with **InsightFace `buffalo_l`**:
- **RetinaFace** (deep learning) for face detection — fewer spurious detections than HOG
- **ArcFace ResNet-50** for 512-dim embeddings — much tighter decision boundary, directly reducing false positives
- **onnxruntime** for inference — CPU-friendly today, trivial GPU upgrade later

LFW benchmark: ~99.8% (InsightFace) vs ~99.3% (dlib). More importantly, ArcFace's margin-based training produces embeddings where genuine pairs cluster tightly and impostor pairs stay far apart — this is exactly what reduces false positives in a reference-matching scenario.

---

## Scope

### Changes

- `python-service/requirements.txt` — remove `face-recognition`, add `insightface` and `onnxruntime`
- `python-service/face_service.py` — rewrite detection/recognition using `insightface.app.FaceAnalysis`
- `python-service/models/` (new directory) — local model cache so `buffalo_l` onnx files (~350MB) download here on first run and persist across restarts
- `package.json` — remove `@vladmandic/face-api`, `@tensorflow/tfjs-node`, `canvas` (dead code)
- `src/download-models.ts` — delete (legacy, no callers)

### Unchanged

- Node.js service entirely
- `/detect` and `/health` HTTP endpoints — same request/response shape
- `reference-faces/` directory structure
- `FACE_CONFIDENCE_THRESHOLD` env var (reinterpreted — see Threshold section)
- Phash caching, processing queue, label application

---

## Detection and Matching Logic

### Startup — Reference Face Enrollment

For each image in `reference-faces/<person>/`:
1. Run RetinaFace detection on the image
2. If multiple faces detected, take the one with the largest bounding box area
3. Extract 512-dim ArcFace embedding (L2-normalized)
4. Append to in-memory list for that person

If an image yields no face: warn and skip (same behavior as today).  
If a person ends up with zero valid embeddings: warn and exclude from matching.

### Per-Request Detection

1. Decode incoming image bytes to numpy array
2. Run RetinaFace detection — get all face bounding boxes
3. If no faces: return `{"matches": []}`
4. If too many faces (> `MAX_FACES_TO_PROCESS`): return `{"matches": [], "skipped": true, "reason": "too_many_faces"}`
5. For each detected face, extract its 512-dim ArcFace embedding
6. For each reference person, compute `max(dot(face_emb, ref_emb) for ref_emb in person_embeddings)` — cosine similarity (both vectors are L2-normalized)
7. Take the single best-matching person across all reference people (highest cosine similarity wins; only one person is reported per detected face)
8. If that similarity ≥ `FACE_CONFIDENCE_THRESHOLD`: add to matches
9. Deduplicate by person (keep highest confidence), return matches

### Confidence Score

Reported directly as the cosine similarity value (0.0–1.0). Same JSON field name (`confidence`) as today.

---

## Threshold

`FACE_CONFIDENCE_THRESHOLD` is reinterpreted as **minimum cosine similarity** (higher = stricter).

| Value | Meaning |
|-------|---------|
| 0.3 | Permissive |
| 0.4 | **Default — good starting point** |
| 0.5 | Strict |

The previous default of `0.6` was an L2 distance; it does not map directly. Start at `0.4` after deployment and raise if false positives persist.

---

## GPU Upgrade Path

When moving to a GPU DigitalOcean droplet:
1. `pip install onnxruntime-gpu` (replaces `onnxruntime`)
2. Change `providers=['CPUExecutionProvider']` → `providers=['CUDAExecutionProvider']` in `face_service.py`

Zero other code changes. Inference drops from ~200–400ms to ~20–50ms per image.

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Model download fails on startup | Exit with clear error message |
| Reference image has no face | Warn and skip |
| Request image decode error | Return 500 |
| No faces in request image | Return `{"matches": []}` |
| Too many faces | Return `{"matches": [], "skipped": true, "reason": "too_many_faces"}` |

---

## Testing

1. Run existing test scripts (`npx tsx test-face-detection.ts`) — these hit `/detect` directly and require no changes
2. Manual spot-check: known Trump image → match; non-Trump face → no match
3. Verify `/health` returns `{status, people_loaded, total_encodings}` (same shape as today)
4. Threshold tuning: start at `0.4`, raise toward `0.5` if false positives remain

---

## Legacy Cleanup

Removing `@vladmandic/face-api`, `@tensorflow/tfjs-node`, and `canvas` from `package.json` is safe — they have no runtime callers in the current codebase. This also reduces `npm install` time significantly on the VPS (these are large, slow-to-install packages).
