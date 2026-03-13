#!/usr/bin/env python3
"""Extract weights from the ASL TFLite model and export as JSON for JS inference."""

import numpy as np
import json
import os

# Load TFLite model
import tensorflow as tf

model_path = os.path.join(os.path.dirname(__file__), '..', 'ios', 'AEYEECHO', 'asl_classifier.tflite')
interpreter = tf.lite.Interpreter(model_path=model_path)
interpreter.allocate_tensors()

# Get all tensor details
details = interpreter.get_tensor_details()

weights = {}
for detail in details:
    name = detail['name']
    tensor = interpreter.get_tensor(detail['index'])
    if tensor.size > 1:  # Skip scalars
        weights[name] = {
            'shape': list(tensor.shape),
            'data': tensor.tolist(),
        }
        print(f"{name}: shape={tensor.shape}, dtype={tensor.dtype}")

# Save as JSON
output_path = os.path.join(os.path.dirname(__file__), '..', 'src', 'services', 'aslWeights.json')
with open(output_path, 'w') as f:
    json.dump(weights, f)

print(f"\nExported {len(weights)} tensors to {output_path}")
print(f"File size: {os.path.getsize(output_path) / 1024:.1f} KB")
