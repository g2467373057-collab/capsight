#!/bin/bash
# Capsight · Batch C (layered evaluation).  Usage:  bash eval/run-batch-c.sh            → all three layers (~25 min)
#                                                   bash eval/run-batch-c.sh intent site → only some layers
#                                                   bash eval/run-batch-c.sh score eval/batch-C/<folder> → re-score after correcting the reference sites
set -e
cd "$(dirname "$0")/../server"
if command -v caffeinate >/dev/null; then KEEP="caffeinate -i"; else KEEP=""; fi
$KEEP node --no-warnings=ExperimentalWarning ../eval/run-batch-c.ts "$@"
