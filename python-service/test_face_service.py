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
