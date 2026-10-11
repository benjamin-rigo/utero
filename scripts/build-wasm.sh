#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
cargo build -p utero-wasm --target wasm32-unknown-unknown --release
mkdir -p web/public
cp target/wasm32-unknown-unknown/release/utero_wasm.wasm web/public/utero.wasm
echo "built web/public/utero.wasm ($(wc -c < web/public/utero.wasm) bytes)"
