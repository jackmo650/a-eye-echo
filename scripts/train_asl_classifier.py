#!/usr/bin/env python3
"""
Train an ASL fingerspelling classifier on hand landmark vectors.

Generates synthetic training data based on known ASL hand configurations,
trains a small neural network, and exports as TFLite for on-device use.

Output: ios/AEYEECHO/asl_classifier.tflite
"""

import numpy as np
import tensorflow as tf
import os

# ASL letters we can classify (static gestures only — J and Z require motion)
LABELS = list("ABCDEFGHIKLMNOPQRSTUVWXY")  # 24 letters (no J, Z)
NUM_CLASSES = len(LABELS)

# 21 landmarks × 3 coords (x, y, z) = 63 features
NUM_FEATURES = 63

def normalize_landmarks(points):
    """Normalize landmarks relative to wrist, scale by palm size."""
    pts = np.array(points).reshape(21, 3)
    wrist = pts[0].copy()
    pts -= wrist  # Center on wrist

    # Scale by palm width (index MCP to pinky MCP)
    palm_width = np.linalg.norm(pts[5] - pts[17])
    if palm_width > 1e-6:
        pts /= palm_width

    return pts.flatten()

def generate_hand_config(finger_states, thumb_state, spread=0.0, curl_variation=0.1):
    """
    Generate a synthetic hand landmark configuration.
    finger_states: [index, middle, ring, pinky] - 0.0=curled, 1.0=extended
    thumb_state: 0.0=tucked, 1.0=extended
    spread: how much fingers spread apart
    """
    # Base hand geometry (rough approximation of MediaPipe landmarks)
    # Wrist at origin, fingers extend upward in -y direction
    pts = np.zeros((21, 3))

    # Wrist
    pts[0] = [0.0, 0.0, 0.0]

    # Thumb (extends to the side)
    thumb_ext = thumb_state + np.random.normal(0, curl_variation)
    thumb_ext = np.clip(thumb_ext, 0, 1)
    pts[1] = [-0.15, -0.08, 0.0]  # CMC
    pts[2] = [-0.25, -0.15, 0.0]  # MCP
    pts[3] = [-0.30 - 0.08 * thumb_ext, -0.22 - 0.05 * thumb_ext, 0.0]  # IP
    pts[4] = [-0.33 - 0.12 * thumb_ext, -0.28 - 0.08 * thumb_ext, 0.0]  # TIP

    # Finger base positions (MCP joints)
    finger_bases = [
        [-0.08 - spread * 0.02, -0.35, 0.0],   # Index MCP
        [0.0, -0.37, 0.0],                       # Middle MCP
        [0.08 + spread * 0.02, -0.35, 0.0],      # Ring MCP
        [0.15 + spread * 0.04, -0.30, 0.0],      # Pinky MCP
    ]

    finger_indices = [
        (5, 6, 7, 8),    # Index
        (9, 10, 11, 12),  # Middle
        (13, 14, 15, 16), # Ring
        (17, 18, 19, 20), # Pinky
    ]

    finger_lengths = [
        [0.0, 0.08, 0.06, 0.05],  # Index segment lengths
        [0.0, 0.09, 0.065, 0.055], # Middle
        [0.0, 0.085, 0.06, 0.05],  # Ring
        [0.0, 0.07, 0.05, 0.04],   # Pinky
    ]

    for f_idx, (ext, (mcp, pip, dip, tip), base, lengths) in enumerate(
        zip(finger_states, finger_indices, finger_bases, finger_lengths)
    ):
        ext_val = ext + np.random.normal(0, curl_variation)
        ext_val = np.clip(ext_val, 0, 1)

        # Spread factor
        spread_offset = spread * (f_idx - 1.5) * 0.03

        pts[mcp] = base
        pts[mcp][0] += spread_offset

        # When curled, fingers bend at PIP/DIP joints
        curl = 1.0 - ext_val

        # PIP - first bend point
        pts[pip] = pts[mcp].copy()
        pts[pip][1] -= lengths[1] * (1.0 - curl * 0.3)
        pts[pip][2] += curl * 0.04

        # DIP
        pts[dip] = pts[pip].copy()
        pts[dip][1] -= lengths[2] * (1.0 - curl * 0.6)
        pts[dip][2] += curl * 0.06

        # TIP
        pts[tip] = pts[dip].copy()
        pts[tip][1] -= lengths[3] * (1.0 - curl * 0.8)
        pts[tip][2] += curl * 0.05

    # Add noise
    pts += np.random.normal(0, 0.008, pts.shape)

    return pts

# ASL letter configurations
# [index, middle, ring, pinky], thumb, spread
ASL_CONFIGS = {
    'A': {'fingers': [0.0, 0.0, 0.0, 0.0], 'thumb': 0.7, 'spread': 0.0},
    'B': {'fingers': [1.0, 1.0, 1.0, 1.0], 'thumb': 0.0, 'spread': 0.0},
    'C': {'fingers': [0.5, 0.5, 0.5, 0.5], 'thumb': 0.5, 'spread': 0.3},
    'D': {'fingers': [1.0, 0.0, 0.0, 0.0], 'thumb': 0.3, 'spread': 0.0},
    'E': {'fingers': [0.0, 0.0, 0.0, 0.0], 'thumb': 0.0, 'spread': 0.0},
    'F': {'fingers': [0.3, 1.0, 1.0, 1.0], 'thumb': 0.3, 'spread': 0.2},
    'G': {'fingers': [0.8, 0.0, 0.0, 0.0], 'thumb': 0.8, 'spread': 0.0},
    'H': {'fingers': [0.9, 0.9, 0.0, 0.0], 'thumb': 0.0, 'spread': 0.0},
    'I': {'fingers': [0.0, 0.0, 0.0, 1.0], 'thumb': 0.0, 'spread': 0.0},
    'K': {'fingers': [1.0, 1.0, 0.0, 0.0], 'thumb': 0.5, 'spread': 0.5},
    'L': {'fingers': [1.0, 0.0, 0.0, 0.0], 'thumb': 1.0, 'spread': 0.0},
    'M': {'fingers': [0.0, 0.0, 0.0, 0.0], 'thumb': 0.2, 'spread': 0.0},
    'N': {'fingers': [0.0, 0.0, 0.0, 0.0], 'thumb': 0.15, 'spread': 0.0},
    'O': {'fingers': [0.3, 0.3, 0.3, 0.3], 'thumb': 0.3, 'spread': 0.0},
    'P': {'fingers': [1.0, 1.0, 0.0, 0.0], 'thumb': 0.6, 'spread': 0.3},
    'Q': {'fingers': [0.6, 0.0, 0.0, 0.0], 'thumb': 0.6, 'spread': 0.0},
    'R': {'fingers': [1.0, 1.0, 0.0, 0.0], 'thumb': 0.0, 'spread': -0.3},
    'S': {'fingers': [0.0, 0.0, 0.0, 0.0], 'thumb': 0.1, 'spread': 0.0},
    'T': {'fingers': [0.0, 0.0, 0.0, 0.0], 'thumb': 0.25, 'spread': 0.0},
    'U': {'fingers': [1.0, 1.0, 0.0, 0.0], 'thumb': 0.0, 'spread': 0.0},
    'V': {'fingers': [1.0, 1.0, 0.0, 0.0], 'thumb': 0.0, 'spread': 0.6},
    'W': {'fingers': [1.0, 1.0, 1.0, 0.0], 'thumb': 0.0, 'spread': 0.4},
    'X': {'fingers': [0.5, 0.0, 0.0, 0.0], 'thumb': 0.0, 'spread': 0.0},
    'Y': {'fingers': [0.0, 0.0, 0.0, 1.0], 'thumb': 1.0, 'spread': 0.0},
}

def generate_dataset(samples_per_class=2000):
    """Generate synthetic dataset of normalized hand landmarks for each ASL letter."""
    X = []
    y = []

    for label_idx, letter in enumerate(LABELS):
        config = ASL_CONFIGS[letter]
        for _ in range(samples_per_class):
            # Vary parameters
            variation = np.random.uniform(0.05, 0.2)
            pts = generate_hand_config(
                config['fingers'],
                config['thumb'],
                config['spread'],
                curl_variation=variation,
            )

            # Random rotation (simulates hand orientation changes)
            angle = np.random.uniform(-0.3, 0.3)  # radians
            cos_a, sin_a = np.cos(angle), np.sin(angle)
            rot = np.array([[cos_a, -sin_a, 0], [sin_a, cos_a, 0], [0, 0, 1]])
            pts = pts @ rot.T

            # Random scale
            scale = np.random.uniform(0.8, 1.2)
            pts *= scale

            # Normalize
            features = normalize_landmarks(pts)
            X.append(features)
            y.append(label_idx)

    return np.array(X, dtype=np.float32), np.array(y, dtype=np.int32)

def build_model():
    """Build a small classifier: 63 features → 24 classes."""
    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(NUM_FEATURES,)),
        tf.keras.layers.Dense(128, activation='relu'),
        tf.keras.layers.Dropout(0.3),
        tf.keras.layers.BatchNormalization(),
        tf.keras.layers.Dense(64, activation='relu'),
        tf.keras.layers.Dropout(0.2),
        tf.keras.layers.Dense(NUM_CLASSES, activation='softmax'),
    ])

    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
        loss='sparse_categorical_crossentropy',
        metrics=['accuracy'],
    )
    return model

def main():
    print("Generating synthetic ASL dataset...")
    X, y = generate_dataset(samples_per_class=2000)

    # Shuffle
    indices = np.random.permutation(len(X))
    X, y = X[indices], y[indices]

    # Split 80/20
    split = int(0.8 * len(X))
    X_train, X_val = X[:split], X[split:]
    y_train, y_val = y[:split], y[split:]

    print(f"Training: {len(X_train)} samples, Validation: {len(X_val)} samples")
    print(f"Classes: {NUM_CLASSES} ({', '.join(LABELS)})")

    model = build_model()
    model.summary()

    history = model.fit(
        X_train, y_train,
        validation_data=(X_val, y_val),
        epochs=20,
        batch_size=64,
        verbose=1,
    )

    val_acc = history.history['val_accuracy'][-1]
    print(f"\nFinal validation accuracy: {val_acc:.4f}")

    # Save as SavedModel first, then convert to TFLite
    saved_model_dir = os.path.join(os.path.dirname(__file__), 'asl_saved_model')
    model.export(saved_model_dir)
    converter = tf.lite.TFLiteConverter.from_saved_model(saved_model_dir)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    tflite_model = converter.convert()

    # Save
    output_dir = os.path.join(os.path.dirname(__file__), '..', 'ios', 'AEYEECHO')
    output_path = os.path.join(output_dir, 'asl_classifier.tflite')
    with open(output_path, 'wb') as f:
        f.write(tflite_model)

    print(f"\nModel saved to: {output_path}")
    print(f"Model size: {len(tflite_model) / 1024:.1f} KB")

    # Also save the label map
    labels_path = os.path.join(output_dir, 'asl_labels.txt')
    with open(labels_path, 'w') as f:
        for label in LABELS:
            f.write(f"{label}\n")
    print(f"Labels saved to: {labels_path}")

if __name__ == '__main__':
    main()
