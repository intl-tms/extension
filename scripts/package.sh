#!/usr/bin/env bash
# Builds the Extension and zips dist/ for upload to the Chrome Web Store.
# Source maps are left out; the manifest must sit at the root of the zip.
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/build.mjs
version=$(node -p "require('./static/manifest.json').version")
mkdir -p dist/releases
zip="releases/intl-tms-$version.zip"
rm -f "dist/$zip"
(cd dist && zip -r "$zip" . -x "*.map" -x "releases/*")
echo "Created dist/$zip"
