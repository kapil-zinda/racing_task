#!/bin/bash
# Build Lambda deployment package (application code only)
# Dependencies should be provided via Lambda Layer(s)

set -e

echo "Building Lambda deployment package (application code)..."

# Configuration
OUTPUT_ZIP="lambda-package.zip"
PACKAGE_DIR="lambda-package"

# Clean up previous builds
echo "Cleaning up previous builds..."
rm -rf "$PACKAGE_DIR"
rm -f "$OUTPUT_ZIP"

# Create package directory
echo "Creating package directory..."
mkdir -p "$PACKAGE_DIR"

# Copy root-level application files
echo "Copying application files..."
cp app.py "$PACKAGE_DIR/"
cp lambda_function.py "$PACKAGE_DIR/"
cp .env.example "$PACKAGE_DIR/" 2>/dev/null || true

# If present, include API spec
cp openapi.yaml "$PACKAGE_DIR/" 2>/dev/null || true

# Remove unnecessary files
echo "Cleaning up unnecessary files..."
cd "$PACKAGE_DIR"

find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find . -type f -name "*.pyc" -delete 2>/dev/null || true
find . -type f -name ".DS_Store" -delete 2>/dev/null || true

# Remove local/dev-only files if present
rm -f local_server.py 2>/dev/null || true
rm -f start.py 2>/dev/null || true

cd ..

# Create zip file
echo "Creating zip file..."
cd "$PACKAGE_DIR"
zip -r "../$OUTPUT_ZIP" . -q
cd ..

# Get file size
FILE_SIZE=$(du -h "$OUTPUT_ZIP" | cut -f1)
FILE_SIZE_KB=$(du -k "$OUTPUT_ZIP" | cut -f1)

echo ""
echo "Lambda package built successfully"
echo "Output file: $OUTPUT_ZIP"
echo "File size: $FILE_SIZE (${FILE_SIZE_KB}KB)"
echo ""
echo "Contents:"
echo " - app.py"
echo " - lambda_function.py"
echo " - .env.example (if present)"
echo ""
echo "Note: This package does NOT include dependencies."
echo "Attach your app dependency Lambda Layer while deploying."
