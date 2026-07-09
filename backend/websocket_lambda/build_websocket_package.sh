#!/bin/bash
# Build the deployment package for the websocket Lambda (API Gateway WebSocket
# API: $connect/$disconnect/$default, plus the EventBridge "broadcast_tick" task).
# Small enough not to need a separate layer (unlike the main REST lambda) —
# dependencies are vendored straight into the package zip.

set -euo pipefail

OUTPUT_ZIP="websocket-lambda-package.zip"
PACKAGE_DIR="websocket-lambda-package"
PYTHON_VERSION="${PYTHON_VERSION:-3.13}"
LAMBDA_ARCH="${LAMBDA_ARCH:-x86_64}"
PLATFORM="manylinux2014_x86_64"
if [ "$LAMBDA_ARCH" = "arm64" ]; then
  PLATFORM="manylinux2014_aarch64"
fi

echo "Building websocket Lambda deployment package..."
rm -rf "$PACKAGE_DIR"
rm -f "$OUTPUT_ZIP"
mkdir -p "$PACKAGE_DIR"

echo "Installing dependencies (pymongo, dnspython)..."
pip install \
  --platform "$PLATFORM" \
  --python-version "$PYTHON_VERSION" \
  --only-binary=:all: \
  --target "$PACKAGE_DIR" \
  -r requirements.txt

echo "Copying application files..."
cp handler.py db.py auth.py connections.py broadcast.py "$PACKAGE_DIR/"

echo "Cleaning up unnecessary files..."
cd "$PACKAGE_DIR"
find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find . -type f -name "*.pyc" -delete 2>/dev/null || true
find . -type f -name ".DS_Store" -delete 2>/dev/null || true

echo "Zipping package..."
zip -r "../$OUTPUT_ZIP" . -x ".*" > /dev/null
cd ..

echo "Done: $OUTPUT_ZIP"
echo
echo "Deploy (first time):"
echo "  aws lambda create-function --function-name dias-websocket \\"
echo "    --runtime python${PYTHON_VERSION} --handler handler.lambda_handler \\"
echo "    --zip-file fileb://$OUTPUT_ZIP --role <execution-role-arn> \\"
echo "    --environment Variables={MONGODB_URI=...,MONGODB_DB=racing_challenge}"
echo
echo "Deploy (update code only):"
echo "  aws lambda update-function-code --function-name dias-websocket --zip-file fileb://$OUTPUT_ZIP"
echo
echo "Then wire it to an API Gateway WebSocket API (routes \$connect/\$disconnect/\$default"
echo "all invoking this function) and an EventBridge rule (rate(1 minute)) invoking it"
echo "with the literal input {\"task\": \"broadcast_tick\"}. Set WEBSOCKET_API_ENDPOINT on"
echo "the function to https://{api-id}.execute-api.{region}.amazonaws.com/{stage} once"
echo "the WebSocket API is created (needed for broadcast_tick's post_to_connection calls)."
