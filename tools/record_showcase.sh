#!/bin/bash
# Re-record the runs for the online demo (server/web/replays) and write its index.
# Needs a running server: cd server && PRISM_HOME=/path/to/prism-4.8 ./gradlew run
# Each line: scenario file | replay id | simulated seconds | operator | recording speed
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=server/web/replays
mkdir -p "$OUT"
while IFS='|' read -r file id secs op speed; do
  [[ -z "$file" || "$file" == \#* ]] && continue
  python3 tools/record_replay.py --file "$file" --id "$id" --seconds "$secs" --operator "$op" --speed "$speed" --out "$OUT"
done <<'LIST'
PFM_SFV.json|pfm-live-prism|240|none|1
PFM_SDV.json|pfm-placebo|240|none|1
PFM_SNV.json|pfm-no-prediction|240|none|1
AllUITest.json|lenses|120|targets|4
usecase.json|triage|180|targets|4
ProggedNoCom.json|programmer-limited-comms|150|targets|4
ProggedWithCom.json|programmer-full-comms|150|targets|4
CurrentNonFixed/DynamicTaskingShiftHeatmap.json|heatmap|58|targets|2
Heatmap/AllocationLens.json|heatmap-lens|180|teams|4
Heatmap/FixedTeams.json|heatmap-teams|180|teams|4
LIST
python3 - "$OUT" <<'PY'
import glob, gzip, json, os, sys
out = sys.argv[1]
items = []
for p in sorted(glob.glob(os.path.join(out, "*.json.gz"))):
    r = json.load(gzip.open(p, "rt"))
    items.append({"id": r["id"], "file": r["file"], "title": r["title"], "duration": r["duration"]})
json.dump({"replays": items}, open(os.path.join(out, "index.json"), "w"), indent=1)
print("index:", len(items), "recordings")
PY
