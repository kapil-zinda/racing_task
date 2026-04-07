#!/usr/bin/env bash
set -euo pipefail

# Build AWS Lambda deployment zip (Python 3.11 Linux compatible)
# Output: backend/dist/lambda_package_py311_linux.zip

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$ROOT_DIR/dist"
BUILD_DIR="$ROOT_DIR/build_linux"
IMAGE="public.ecr.aws/lambda/python:3.11"

rm -rf "$BUILD_DIR" "$DIST_DIR"
mkdir -p "$BUILD_DIR" "$DIST_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to build a Linux-compatible Lambda package." >&2
  exit 1
fi

echo "Building Lambda package using Docker image: $IMAGE"
docker run --rm \
  -v "$ROOT_DIR":/var/task \
  "$IMAGE" \
  /bin/sh -c "pip install -r /var/task/requirements.txt -t /var/task/build_linux && cp /var/task/app.py /var/task/lambda_function.py /var/task/build_linux/"

(
  cd "$BUILD_DIR"
  zip -r ../dist/lambda_package_py311_linux.zip . >/dev/null
)

echo "Created package: $DIST_DIR/lambda_package_py311_linux.zip"
