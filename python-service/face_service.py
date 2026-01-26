#!/usr/bin/env python3
"""
Face Detection Microservice

Provides face detection and recognition API for the Bluesky labeler.
"""

import os
import face_recognition
import numpy as np
from flask import Flask, request, jsonify
from PIL import Image
import io
import logging

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Store reference face encodings in memory
reference_encodings = {}
REFERENCE_FACES_DIR = os.path.join(os.path.dirname(__file__), '..', 'reference-faces')
CONFIDENCE_THRESHOLD = float(os.getenv('FACE_CONFIDENCE_THRESHOLD', '0.6'))
MAX_FACES_TO_PROCESS = int(os.getenv('MAX_FACES_TO_PROCESS', '50'))


def load_reference_faces():
    """Load all reference face encodings from the reference-faces directory"""
    logger.info(f"Loading reference faces from {REFERENCE_FACES_DIR}...")

    if not os.path.exists(REFERENCE_FACES_DIR):
        logger.warning(f"Reference faces directory not found: {REFERENCE_FACES_DIR}")
        return

    # Iterate through person directories
    for person_name in os.listdir(REFERENCE_FACES_DIR):
        person_dir = os.path.join(REFERENCE_FACES_DIR, person_name)

        if not os.path.isdir(person_dir):
            continue

        logger.info(f"Loading reference faces for {person_name}...")
        encodings = []

        # Load all images for this person
        for image_file in os.listdir(person_dir):
            if not image_file.lower().endswith(('.jpg', '.jpeg', '.png')):
                continue

            image_path = os.path.join(person_dir, image_file)

            try:
                # Load image and get face encoding
                image = face_recognition.load_image_file(image_path)
                face_encodings = face_recognition.face_encodings(image)

                if len(face_encodings) > 0:
                    encodings.append(face_encodings[0])
                    logger.info(f"  ✓ Loaded {person_name}/{image_file}")
                else:
                    logger.warning(f"  ✗ No face found in {person_name}/{image_file}")

            except Exception as e:
                logger.error(f"  ✗ Error loading {person_name}/{image_file}: {e}")

        if encodings:
            reference_encodings[person_name] = encodings
            logger.info(f"Loaded {len(encodings)} face encodings for {person_name}")
        else:
            logger.warning(f"No valid face encodings loaded for {person_name}")

    logger.info(f"Total people loaded: {len(reference_encodings)}")


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'people_loaded': list(reference_encodings.keys()),
        'total_encodings': sum(len(encs) for encs in reference_encodings.values())
    })


@app.route('/detect', methods=['POST'])
def detect_faces():
    """
    Detect and recognize faces in an uploaded image

    Returns:
        {
            "matches": [
                {"person": "trump", "confidence": 0.85},
                ...
            ]
        }
    """
    if 'image' not in request.files:
        return jsonify({'error': 'No image provided'}), 400

    try:
        # Read image from request
        image_file = request.files['image']
        image_bytes = image_file.read()

        # Convert to PIL Image then to numpy array
        pil_image = Image.open(io.BytesIO(image_bytes))

        # Convert to RGB if needed
        if pil_image.mode != 'RGB':
            pil_image = pil_image.convert('RGB')

        # Convert to numpy array
        # Note: Image resizing is handled by the Node.js service before sending
        image_array = np.array(pil_image)

        # Detect faces in the image
        face_locations = face_recognition.face_locations(image_array)

        if not face_locations:
            logger.info("No faces detected in image")
            return jsonify({'matches': []})

        logger.info(f"Detected {len(face_locations)} face(s) in image")

        # Skip images with too many faces (crowd photos, mosaics) to prevent OOM
        if len(face_locations) > MAX_FACES_TO_PROCESS:
            logger.warning(f"Skipping image with {len(face_locations)} faces (max: {MAX_FACES_TO_PROCESS})")
            return jsonify({'matches': [], 'skipped': True, 'reason': 'too_many_faces'})

        # Get face encodings
        face_encodings = face_recognition.face_encodings(image_array, face_locations)

        # Match against reference faces
        matches = []

        for face_encoding in face_encodings:
            best_match = None
            best_distance = float('inf')

            # Compare against all reference faces
            for person_name, ref_encodings in reference_encodings.items():
                # Compare against all encodings for this person
                distances = face_recognition.face_distance(ref_encodings, face_encoding)
                min_distance = np.min(distances)

                # Lower distance = better match
                if min_distance < best_distance:
                    best_distance = min_distance
                    best_match = person_name

            # Convert distance to confidence (0-1 scale)
            # face_recognition uses 0.6 as default threshold
            # We'll use: confidence = 1 - (distance / threshold)
            if best_match and best_distance < CONFIDENCE_THRESHOLD:
                confidence = 1.0 - (best_distance / CONFIDENCE_THRESHOLD)
                matches.append({
                    'person': best_match,
                    'confidence': round(confidence, 3)
                })
                logger.info(f"Match found: {best_match} (confidence: {confidence:.3f}, distance: {best_distance:.3f})")

        # Deduplicate matches (same person detected multiple times)
        unique_matches = {}
        for match in matches:
            person = match['person']
            if person not in unique_matches or match['confidence'] > unique_matches[person]['confidence']:
                unique_matches[person] = match

        return jsonify({'matches': list(unique_matches.values())})

    except Exception as e:
        logger.error(f"Error processing image: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    # Load reference faces on startup
    load_reference_faces()

    # Start Flask server
    port = int(os.getenv('PORT', '5000'))
    app.run(host='0.0.0.0', port=port, debug=False)
