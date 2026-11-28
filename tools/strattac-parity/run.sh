#!/usr/bin/env bash
# Checks the HARIS StratTac engine against the original study code.
# Usage: tools/strattac-parity/run.sh /path/to/GraphColouringNew   (a checkout with npm install done)
set -euo pipefail
ORIG=$(cd "$1" && pwd)
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
OUT=$(mktemp -d)
(cd "$ROOT/server" && ./gradlew -q compileJava)
GSON=$(find ~/.gradle -name 'gson-2.2.2.jar' | head -1)
CP="$ROOT/server/build/classes/java/main:$GSON"
javac -nowarn -d "$OUT" -cp "$CP" "$HERE"/*.java
mkdir -p "$ORIG/sim/haris-parity"
cp "$HERE"/*.mts "$ORIG/sim/haris-parity/"
sed -i 's#\.\./src/#../../src/#g' "$ORIG/sim/haris-parity/"*.mts
ts() { (cd "$ORIG" && npx tsx "sim/haris-parity/$1.mts" "${@:2}"); }
jv() { java -cp "$CP:$OUT" "$@" 2>/dev/null; }
echo "== Mission plans";            ts plans > "$OUT/a"; jv PlansDump > "$OUT/b"; python3 "$HERE/cmp.py" "$OUT/a" "$OUT/b"
echo "== Strategic Assistant cards"; ts strat > "$OUT/a"; jv StratDump > "$OUT/b"; python3 "$HERE/cmp.py" "$OUT/a" "$OUT/b"
echo "== Tactical Assistant plans";  ts tac   > "$OUT/a"; jv TacDump   > "$OUT/b"; python3 "$HERE/cmp.py" "$OUT/a" "$OUT/b"
echo "== Whole sessions, scripted operator (last field, event count, differs by the Suggest clicks the Java operator logs)"
for cx in balanced strategic tactical full; do ts run $cx "${SEEDS:-5}" > "$OUT/a"; jv RunJ $cx "${SEEDS:-5}" > "$OUT/b"
  python3 - "$OUT/a" "$OUT/b" "$cx" <<'PY'
import sys
a=[l.split('|')[:-1] for l in open(sys.argv[1]) if '|' in l]; b=[l.split('|')[:-1] for l in open(sys.argv[2]) if '|' in l]
print(sys.argv[3], len(a), 'sessions,', sum(x==y for x,y in zip(a,b)), 'identical outcomes')
PY
done
rm -rf "$ORIG/sim/haris-parity"
