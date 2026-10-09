#!/usr/bin/env python3
"""
Download MediaPipe Pose Landmarker model bundle.

Run this script to download the .task model file required by the PoseExtractor.
"""

import os
import urllib.request
import hashlib

MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task"
MODEL_PATH = "backend/models/pose_landmarker_full.task"
EXPECTED_SHA256 = "b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8"  # Placeholder

def download_model():
    """Download the MediaPipe Pose Landmarker model."""
    os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
    
    if os.path.exists(MODEL_PATH):
        print(f"Model already exists at {MODEL_PATH}")
        # Verify checksum
        with open(MODEL_PATH, 'rb') as f:
            actual_sha256 = hashlib.sha256(f.read()).hexdigest()
        if actual_sha256 == EXPECTED_SHA256:
            print("Checksum verified.")
            return
        print("Checksum mismatch, re-downloading...")
    
    print(f"Downloading MediaPipe model from {MODEL_URL}...")
    try:
        urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
        print(f"Downloaded to {MODEL_PATH}")
        
        # Verify
        with open(MODEL_PATH, 'rb') as f:
            actual_sha256 = hashlib.sha256(f.read()).hexdigest()
        print(f"SHA256: {actual_sha256}")
        
    except Exception as e:
        print(f"Download failed: {e}")
        print("\nManual download:")
        print(f"1. Go to: https://developers.google.com/mediapipe/solutions/vision/pose_landmarker")
        print(f"2. Download 'pose_landmarker_full.task'")
        print(f"3. Place at: {MODEL_PATH}")

if __name__ == "__main__":
    download_model()