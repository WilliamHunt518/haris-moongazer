#!/usr/bin/env bash
# Fold the fork's old branches into archive/<branch> tags, then delete the branches.
# See docs/legacy/branches.md for what each one holds.
#
# Run from anywhere with git and push access to the fork (Git Bash works on Windows):
#   bash tools/archive_branches.sh            # dry run: shows what would happen
#   bash tools/archive_branches.sh --apply    # does it
#
# Only ever touches the fork below. It never deletes a branch until its tag is
# confirmed on GitHub at the same commit, and it writes a git bundle of every
# branch first as an extra backup.
set -euo pipefail

FORK="https://github.com/WilliamHunt518/haris-moongazer.git"
APPLY=0; [ "${1:-}" = "--apply" ] && APPLY=1

BRANCHES=(
  # fully contained in moongazer
  temp_devmerge dev feat_testFramework phase1-run-anywhere port-pfm remove-provstore-key
  launch-page smooth-and-looks launch-guard demo-replay hare-logo site-shots
  claude/project-thread-6m71d3
  # ported into moongazer
  dev_verification
  # not in moongazer (kept as tags)
  exp_degradation_coloured exp_degradation feat_nBack exp_fastpi
  xprize_mcs_dev_fay_clean xprize_mcs_dev_rm xprize_mcs_dev xprize_mcs xprize_mcs_dev_fay
  proj_xPrize dev_RM exp_ai_demo exp_resolutionStudy exp_exSwarm dev_jobAllocation
  master
)
# Claude's working branches: archived and deleted only once merged into moongazer
MERGED_ONLY=(claude/project-thread-k39rhi)
# Never touched: moongazer, demo_2players, experiment_multipleUsers

WORK="$(mktemp -d)"
echo "Working in $WORK"
git clone --quiet --mirror "$FORK" "$WORK/fork.git"
cd "$WORK/fork.git"

DEFAULT="$(git ls-remote --symref origin HEAD | awk '/^ref:/ {sub("refs/heads/","",$2); print $2}')"
echo "Default branch on GitHub: $DEFAULT"

BUNDLE="$HOME/haris-moongazer-branches-$(date +%Y%m%d-%H%M%S).bundle"
git bundle create "$BUNDLE" --branches --tags >/dev/null 2>&1
echo "Backup bundle: $BUNDLE"

for b in "${MERGED_ONLY[@]}"; do
  if git rev-parse -q --verify "refs/heads/$b" >/dev/null && \
     git merge-base --is-ancestor "refs/heads/$b" refs/heads/moongazer; then
    BRANCHES+=("$b")
  else
    echo "skip  $b (missing or not merged into moongazer yet)"
  fi
done

TODO=()
for b in "${BRANCHES[@]}"; do
  sha="$(git rev-parse -q --verify "refs/heads/$b" || true)"
  if [ -z "$sha" ]; then echo "skip  $b (no such branch)"; continue; fi
  if [ "$b" = "$DEFAULT" ]; then
    echo "skip  $b (it is the default branch; set the default to moongazer first, then re-run)"
    git tag -f "archive/$b" "$sha" >/dev/null
    continue
  fi
  git tag -f "archive/$b" "$sha" >/dev/null
  TODO+=("$b")
  echo "plan  $b  ->  archive/$b  ${sha:0:10}"
done

if [ "$APPLY" -ne 1 ]; then
  echo; echo "Dry run only. Re-run with --apply to push the tags and delete ${#TODO[@]} branches."
  exit 0
fi

echo; echo "Pushing tags..."
git push --quiet origin 'refs/tags/archive/*:refs/tags/archive/*'

echo "Checking tags on GitHub..."
REMOTE="$(git ls-remote origin 'refs/tags/archive/*')"
OK=()
for b in "${TODO[@]}"; do
  want="$(git rev-parse "refs/heads/$b")"
  got="$(printf '%s\n' "$REMOTE" | awk -v r="refs/tags/archive/$b" '$2==r {print $1}')"
  if [ "$got" = "$want" ]; then OK+=("$b"); else echo "NOT deleting $b: tag missing or different on GitHub"; fi
done

if [ "${#OK[@]}" -gt 0 ]; then
  echo "Deleting ${#OK[@]} branches..."
  git push --quiet origin --delete "${OK[@]}"
fi
echo "Done. Branches left on GitHub:"
git ls-remote --heads origin | sed 's#.*refs/heads/#  #'
