#!/bin/bash
# Capsight · run the Gate 2 test set.   Usage:  bash eval/run-batch.sh A     (or B for the second batch)
# Takes about 20–30 minutes. Keep the Mac awake and the window open.
set -e
cd "$(dirname "$0")/../server"
LABEL="${1:-A}"
shift || true
caffeinate -i node --no-warnings=ExperimentalWarning ../eval/run-batch.ts "$LABEL" "$@"
