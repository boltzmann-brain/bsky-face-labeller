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

try:
    face_analyzer = FaceAnalysis(
        name='buffalo_l',
        root=MODELS_DIR,
        providers=['CPUExecutionProvider'],
    )
    face_analyzer.prepare(ctx_id=0, det_size=(1024, 1024))
except Exception as e:
    import sys
    print(f"FATAL: Failed to initialize InsightFace buffalo_l model: {e}", file=sys.stderr)
    print("Ensure the model can be downloaded to python-service/models/ on first run.", file=sys.stderr)
    sys.exit(1)


def _normalize(v: np.ndarray) -> np.ndarray | None:
    """Return L2-normalized vector, or None if the vector is zero."""
    norm = np.linalg.norm(v)
    return v / norm if norm > 0 else None


def get_face_embedding(image_array: np.ndarray) -> np.ndarray | None:
    """Return the 512-dim L2-normalized ArcFace embedding for the largest detected face, or None."""
    faces = face_analyzer.get(image_array)
    if not faces:
        return None
    largest = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
    return _normalize(largest.embedding)


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

    if not reference_embeddings:
        logger.warning("No reference embeddings loaded — returning empty matches")
        return jsonify({'matches': []})

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
            face_emb = _normalize(face.embedding)
            if face_emb is None:
                continue
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
