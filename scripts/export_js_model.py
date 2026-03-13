#!/usr/bin/env python3
"""
Retrain the ASL classifier without quantization and export weights as JS module.
This creates a pure JS inference function — no TFLite runtime needed.
"""

import numpy as np
import json
import os
import sys

# Import the training script's functions
sys.path.insert(0, os.path.dirname(__file__))
from train_asl_classifier import generate_dataset, LABELS, NUM_FEATURES, NUM_CLASSES

import tensorflow as tf

print("Generating dataset...")
X, y = generate_dataset(samples_per_class=2000)
indices = np.random.permutation(len(X))
X, y = X[indices], y[indices]
split = int(0.8 * len(X))
X_train, X_val = X[:split], X[split:]
y_train, y_val = y[:split], y[split:]

# Build model (no batch norm — simpler for JS export)
model = tf.keras.Sequential([
    tf.keras.layers.Input(shape=(NUM_FEATURES,)),
    tf.keras.layers.Dense(128, activation='relu'),
    tf.keras.layers.Dropout(0.3),
    tf.keras.layers.Dense(64, activation='relu'),
    tf.keras.layers.Dropout(0.2),
    tf.keras.layers.Dense(NUM_CLASSES, activation='softmax'),
])

model.compile(
    optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
    loss='sparse_categorical_crossentropy',
    metrics=['accuracy'],
)

print("Training...")
model.fit(X_train, y_train, validation_data=(X_val, y_val), epochs=25, batch_size=64, verbose=0)

val_loss, val_acc = model.evaluate(X_val, y_val, verbose=0)
print(f"Validation accuracy: {val_acc:.4f}")

# Extract weights
layers = []
for layer in model.layers:
    w = layer.get_weights()
    if len(w) == 2:  # Dense layer: [weights, biases]
        layers.append({
            'weights': w[0].tolist(),  # shape: [in, out]
            'biases': w[1].tolist(),   # shape: [out]
        })

# Export as TypeScript module
output_path = os.path.join(os.path.dirname(__file__), '..', 'src', 'services', 'aslModel.ts')

ts_content = f"""// Auto-generated ASL fingerspelling classifier weights
// Trained on synthetic hand landmark data — {val_acc:.1%} validation accuracy
// Input: 63 floats (21 landmarks × 3 coords, normalized)
// Output: 24 classes ({', '.join(LABELS)})
// Model: 63 → 128 (ReLU) → 64 (ReLU) → 24 (softmax)

export const ASL_LABELS = {json.dumps(LABELS)};

const L0_W: number[][] = {json.dumps(layers[0]['weights'])};
const L0_B: number[] = {json.dumps(layers[0]['biases'])};
const L1_W: number[][] = {json.dumps(layers[1]['weights'])};
const L1_B: number[] = {json.dumps(layers[1]['biases'])};
const L2_W: number[][] = {json.dumps(layers[2]['weights'])};
const L2_B: number[] = {json.dumps(layers[2]['biases'])};

function relu(x: number): number {{ return x > 0 ? x : 0; }}

function matmul(input: number[], weights: number[][], biases: number[], activation: 'relu' | 'softmax'): number[] {{
  const out = new Array(biases.length);
  for (let j = 0; j < biases.length; j++) {{
    let sum = biases[j];
    for (let i = 0; i < input.length; i++) {{
      sum += input[i] * weights[i][j];
    }}
    out[j] = activation === 'relu' ? relu(sum) : sum;
  }}
  if (activation === 'softmax') {{
    const max = Math.max(...out);
    const exps = out.map(v => Math.exp(v - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map(v => v / sum);
  }}
  return out;
}}

/**
 * Classify ASL letter from normalized hand landmarks.
 * @param landmarks 63 floats: 21 points × (x, y, z), normalized to wrist + palm width
 * @returns {{ letter: string, confidence: number }} or null if low confidence
 */
export function classifyASL(landmarks: number[]): {{ letter: string; confidence: number }} | null {{
  if (landmarks.length !== 63) return null;

  const h1 = matmul(landmarks, L0_W, L0_B, 'relu');
  const h2 = matmul(h1, L1_W, L1_B, 'relu');
  const probs = matmul(h2, L2_W, L2_B, 'softmax');

  let maxIdx = 0;
  let maxProb = probs[0];
  for (let i = 1; i < probs.length; i++) {{
    if (probs[i] > maxProb) {{
      maxProb = probs[i];
      maxIdx = i;
    }}
  }}

  if (maxProb < 0.5) return null;

  return {{ letter: ASL_LABELS[maxIdx], confidence: maxProb }};
}}
"""

with open(output_path, 'w') as f:
    f.write(ts_content)

print(f"Exported to {output_path}")
print(f"File size: {os.path.getsize(output_path) / 1024:.1f} KB")
