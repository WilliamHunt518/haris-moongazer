#!/bin/bash
# Build the GitHub Pages site into _site/: the showcase site at the root and the demo app (the real interface in
# replay mode, playing server/web/replays) under app/. Used by .github/workflows/pages.yml.
#
# HARIS_MAPS_KEY_PAGES: a Google Maps key restricted to the Pages address (HTTP referrer). Without it the pages
# still build, but the map shows Google's error instead of tiles.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf _site
mkdir -p _site/app
cp -r site/. _site/
cp -r server/web/. _site/app/
test -f _site/app/replays/index.json || { echo "No recordings: run tools/record_showcase.sh first" >&2; exit 1; }

# Demo mode for the launch page; only the Pages build has it, the live server never does
python3 - <<'PY'
import os, re
p = "_site/app/index.html"
s = open(p).read()
s = s.replace('<script src="theme/look.js"></script>',
              '<script>window.MG_DEMO = true;</script>\n    <script src="theme/look.js"></script>', 1)
assert "MG_DEMO" in s
open(p, "w").write(s)
key = os.environ.get("HARIS_MAPS_KEY_PAGES", "")
for root, _, files in os.walk("_site/app"):
    for f in files:
        if f.endswith(".html"):
            q = os.path.join(root, f)
            t = open(q, encoding="utf-8", errors="surrogateescape").read()
            if "%HARIS_MAPS_KEY%" in t:
                open(q, "w", encoding="utf-8", errors="surrogateescape").write(t.replace("%HARIS_MAPS_KEY%", key))
print("Maps key:", "set" if key else "not set (map will show an error)")
PY
# Pages serves files as they are; no Jekyll processing
touch _site/.nojekyll
du -sh _site
