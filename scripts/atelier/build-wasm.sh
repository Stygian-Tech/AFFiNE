#!/usr/bin/env bash
set -euo pipefail

task_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
task_crate="$task_root/packages/common/atelier-document"

# The CLI and crate must match to generate compatible JavaScript bindings.
task_bindgen_version="0.2.127"
if ! command -v wasm-bindgen >/dev/null 2>&1; then
  printf 'Install wasm-bindgen-cli %s with cargo install wasm-bindgen-cli --version %s --locked\n' "$task_bindgen_version" "$task_bindgen_version" >&2
  exit 1
fi
if [[ "$(wasm-bindgen --version)" != "wasm-bindgen $task_bindgen_version" ]]; then
  printf 'Expected wasm-bindgen-cli %s; installed: %s\n' "$task_bindgen_version" "$(wasm-bindgen --version)" >&2
  exit 1
fi

cargo build --manifest-path "$task_crate/Cargo.toml" --locked \
  --release --target wasm32-unknown-unknown
wasm-bindgen --target web --out-dir "$task_crate/pkg" \
  "$task_crate/target/wasm32-unknown-unknown/release/atelier_document.wasm"
printf '{"type":"module"}\n' > "$task_crate/pkg/package.json"
