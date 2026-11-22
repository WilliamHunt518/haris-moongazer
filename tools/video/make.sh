#!/bin/bash
# Record the presentation videos and the website clips from the recorded runs in server/web/replays.
# Needs: a running server (cd server && ./gradlew run), Node with Playwright, ffmpeg.
# Without HARIS_MAPS_KEY the map is drawn as a plain grid, which avoids Google's "for development purposes only" tiles.
# With a key (set on the server), pass REAL_MAP=1 to keep Google's map.
set -euo pipefail
cd "$(dirname "$0")"
OUT=${HARIS_VIDEO_OUT:-$PWD/out}; export HARIS_VIDEO_OUT=$OUT; mkdir -p "$OUT"
node card.js '[{"name":"title","q":{}},{"name":"title_long","q":{"k":"Feature tour"}},{"name":"end","q":{"t":"Open-source human–swarm interaction research platform","u":"github.com/WilliamHunt518/haris-moongazer<small>williamhunt518.github.io/haris-moongazer</small>"}}]'
run() { local s=$1; shift; for n in "$@"; do node "$s" "$n" & done; wait; }
run short.js heat pfm scout
run long.js launch pfm lens triage; run long.js scout heat prog
python3 assemble.py "$OUT/haris-moongazer-short.mp4" "$OUT/title.png:2.6" "$OUT"/seg_short_{heat,pfm,scout}.mp4 "$OUT/end.png:3.2"
python3 assemble.py "$OUT/haris-moongazer-tour.mp4" "$OUT/title_long.png:3" "$OUT"/seg_long_{launch,pfm,lens,triage,scout,heat,prog}.mp4 "$OUT/end.png:4"
# Website clips (site/media) and launch screenshot
node clips.js launch pfm_live pfm_placebo & node clips.js pfm_none tri scout & node clips.js heat_lens heat_teams heat_study & node clips.js prog_c prog_u & wait
M=../../site/media; mkdir -p $M
for n in pfm_live pfm_placebo pfm_none tri heat_lens heat_teams heat_study prog_c prog_u scout; do
  ffmpeg -loglevel error -y -i "$OUT/site/${n}_raw.mp4" -vf scale=1280:-2 -an -c:v libx264 -preset slow -crf 28 -pix_fmt yuv420p -movflags +faststart $M/$n.mp4
  ffmpeg -loglevel error -y -ss 0.5 -i $M/$n.mp4 -frames:v 1 -c:v libwebp -quality 78 $M/$n.webp
done
python3 assemble.py "$OUT/overview.mp4" "$OUT"/site/{heat_lens,pfm_live,tri,scout}_raw.mp4
ffmpeg -loglevel error -y -i "$OUT/overview.mp4" -vf scale=1600:-2 -an -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p -movflags +faststart $M/overview.mp4
ffmpeg -loglevel error -y -ss 1 -i $M/overview.mp4 -frames:v 1 -c:v libwebp -quality 80 $M/overview.webp
ffmpeg -loglevel error -y -i "$OUT/haris-moongazer-tour.mp4" -an -c:v libx264 -preset slow -crf 25 -pix_fmt yuv420p -movflags +faststart $M/tour.mp4
ffmpeg -loglevel error -y -ss 12 -i $M/tour.mp4 -frames:v 1 -c:v libwebp -quality 80 $M/tour.webp
ffmpeg -loglevel error -y -i "$OUT/site/launch.png" -c:v libwebp -quality 82 ../../site/img/launch.webp
echo "Videos in $OUT, site media in site/media"
