#!/bin/bash
# Build Lambda Layer for application dependencies

set -euo pipefail

echo "Building app Lambda Layer..."

# Configuration
LAYER_NAME="racing-app-layer"
PYTHON_VERSION="${PYTHON_VERSION:-3.11}"
LAYER_DIR="lambda-layer-app"
OUTPUT_ZIP="lambda-layer-app.zip"
REQ_FILE="./requirements-app.txt"

# Check requirements file
if [ ! -f "$REQ_FILE" ]; then
  echo "Error: requirements-app.txt not found at $REQ_FILE"
  exit 1
fi

# Cleanup
echo "Cleaning previous build..."
rm -rf "$LAYER_DIR"
rm -f "$OUTPUT_ZIP"

# Create layer structure
echo "Creating layer structure..."
mkdir -p "$LAYER_DIR/python"

TARGET_DIR="$LAYER_DIR/python"

# Install Linux-compatible wheels
echo "Installing dependencies..."
pip3 install \
  --platform manylinux2014_x86_64 \
  --target="$TARGET_DIR" \
  --implementation cp \
  --python-version "$PYTHON_VERSION" \
  --only-binary=:all: \
  --upgrade \
  -r "$REQ_FILE"

echo "Dependencies installed."

# Cleanup extra files
echo "Cleaning unnecessary files..."
cd "$TARGET_DIR"
find . -type d -name "tests" -exec rm -rf {} + 2>/dev/null || true
find . -type d -name "test" -exec rm -rf {} + 2>/dev/null || true
find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find . -type f -name "*.pyc" -delete 2>/dev/null || true
find . -type f -name "*.md" -delete 2>/dev/null || true
find . -type f -name "*.rst" -delete 2>/dev/null || true
rm -rf ./bin 2>/dev/null || true
cd - >/dev/null

# Zip
echo "Creating zip..."
cd "$LAYER_DIR"
zip -r "../$OUTPUT_ZIP" . -q
cd - >/dev/null

FILE_SIZE=$(du -h "$OUTPUT_ZIP" | cut -f1)
FILE_SIZE_MB=$(du -m "$OUTPUT_ZIP" | cut -f1)

echo ""
echo "Lambda layer built successfully."
echo "Layer name: $LAYER_NAME"
echo "Output: $OUTPUT_ZIP"
echo "Size: $FILE_SIZE (${FILE_SIZE_MB}MB)"

if [ "$FILE_SIZE_MB" -gt 50 ]; then
  echo "Warning: >50MB. Upload via S3 may be required."
fi
