# Archived branches

When HARIS Moongazer became the main line of this fork, the older branches copied from [SooratiLab/haris](https://github.com/SooratiLab/haris) were folded away. Each one is kept as a tag named `archive/<branch>`, pointing at the branch's last commit, so nothing is lost. The original branches also still exist upstream.

To look at one, or to start new work from it:

```bash
git fetch origin 'refs/tags/archive/*:refs/tags/archive/*'
git log archive/exp_ai_demo                 # browse it
git switch -c port-ai-demo archive/exp_ai_demo   # work from it
```

Branches still live in the fork: `moongazer` (main line), and `demo_2players` with `experiment_multipleUsers` (two-player work, kept for later).

- [Fully contained in Moongazer](#fully-contained-in-moongazer)
- [Ported into Moongazer](#ported-into-moongazer)
- [Not in Moongazer](#not-in-moongazer)

## Fully contained in Moongazer

Every commit of these branches is in `moongazer`'s history, so the tag is only a bookmark.

| Tag | Last commit | What it was |
|---|---|---|
| `archive/temp_devmerge` | 2024-03-24 `1ad2e56801` | The merge of the 2022 to 2024 development branches that Moongazer started from |
| `archive/dev` | 2022-08-26 `9df88c09e9` | Shared development line up to 2022 |
| `archive/feat_testFramework` | 2024-03-02 `9ae174529c` | Test framework work, merged into `temp_devmerge` |
| `archive/phase1-run-anywhere` | 2026-11-21 `546babe17c` | Moongazer PR #1: Gradle, Java 21, Maps key setting, CI |
| `archive/port-pfm` | 2026-11-21 `ed25d5f38d` | Moongazer PR #2: predictive fleet management port |
| `archive/remove-provstore-key` | 2026-11-21 `558f386fa7` | Moongazer PR #3 |
| `archive/launch-page` | 2026-11-21 `b2c9a6602b` | Moongazer PR #4: showcase launch page |
| `archive/smooth-and-looks` | 2026-11-21 `340235e39d` | Moongazer PR #5: tick rate, Classic/Modern look |
| `archive/launch-guard` | 2026-11-21 `7af079f175` | Moongazer PR #6 |
| `archive/demo-replay` | 2026-11-21 `2935cbea72` | Moongazer PR #7: recorded replays and the Pages site |
| `archive/hare-logo` | 2026-11-21 `01a9096ba9` | Moongazer PR #8: the hare logo |
| `archive/site-shots` | 2026-11-21 `5cd0df0a5e` | Site screenshots, merged with PR #8 |
| `archive/claude/project-thread-6m71d3` | 2026-11-22 `84c41b3f74` | Moongazer PR #9: the documentation rewrite |

## Ported into Moongazer

| Tag | Last commit | What it was | In Moongazer |
|---|---|---|---|
| `archive/dev_verification` | 2023-09-05 `4b8b0b0b10` | Predictive fleet management study (PRISM estimates, mission cost, add and remove agents, autorun), with Ayo | Re-implemented on the new engine in PR #2 and checked against this branch with real PRISM. Study scenarios are now `PFM_SFV`, `PFM_SDV`, `PFM_SNV`, `PFM_Tutorial` and `scenarios/PFM_extra/`. |

## Not in Moongazer

These hold work that Moongazer does not have. Where one branch grew out of another, the larger one is listed first and the smaller one is included in it.

| Tag | Last commit | Authors | What it holds |
|---|---|---|---|
| `archive/exp_degradation_coloured` | 2025-10-27 `2b3667fc3d` | Will Hunt | Swarm degradation and workload study: n-back style episodes and an episode generator (balanced decks, Hierholzer ordering), LSL (Lab Streaming Layer) event logging for fNIRS, workload slider and review periods, keypress reactions, flocking, a colour-coded variant, a screen recorder, and an automatic log processor. Includes `exp_degradation` and `feat_nBack`. Ported: the final colour-coded study (`episodes` in a scenario, `Degradation_Tutorial.json` and `Degradation_A` to `D`), the deck generator, LSL markers, the per-episode recorder and the log processor (rewritten). The earlier n-back scenarios and generators were not ported. |
| `archive/exp_degradation` | 2025-06-12 `218cc6a7ee` | Will Hunt | The same study before the colour system and recorder (FastPI pilot version). Includes `feat_nBack`. |
| `archive/feat_nBack` | 2025-01-10 `1fccf790e1` | Will Hunt | First n-back episode version with LSL logging and the tutorial markers. |
| `archive/exp_fastpi` | 2025-01-22 `39b1396b82` | Will Hunt | Later fixes to the heatmap abstraction: a fixed-grid heatmap, task heatmaps, drag-and-drop allocation arrows, log processing. Moongazer's adaptive abstraction tile uses the earlier version from `temp_devmerge`. Ported in PR #11 (heatmap parts; the review overlay and log processing were not ported). |
| `archive/xprize_mcs_dev_fay_clean` | 2025-10-18 `7155305568` | Ayomide Agunloye, Toby Godfrey, Ron0Studios, Will Hunt | XPrize wildfire mission control: risk heatmap with hexbins and weight sliders, GeoJSON map layers, fire and surveillance targets, mission, drone, DDS log and path-planning views with waypoints, fire view fed by DDS (Zenoh router, FlatBuffers aircraft state), image pipeline, Windows setup script. Includes `xprize_mcs`, `xprize_mcs_dev_fay`, `proj_xPrize` and `dev_RM`. |
| `archive/xprize_mcs_dev_rm` | 2025-10-14 `344fffa7ae` | Ron0Studios and others | As above, plus two commits not elsewhere: fire view timeline history and a first TCP publish/subscribe link. |
| `archive/xprize_mcs_dev` | 2025-10-08 `18d017da14` | Ayomide Agunloye and others | As above, plus two commits not elsewhere: an earlier version of the PowerShell setup script. |
| `archive/xprize_mcs` | 2025-10-18 `b7dd2bf658` | Ayomide Agunloye, Toby Godfrey and others | Included in `xprize_mcs_dev_fay_clean`. |
| `archive/xprize_mcs_dev_fay` | 2025-10-08 `8468294325` | Ayomide Agunloye and others | Included in `xprize_mcs_dev_fay_clean`. |
| `archive/proj_xPrize` | 2025-06-27 `e6f8843f23` | Ron0Studios, Will Hunt | Risk map and surveillance groundwork, abort button, draft state specification. Included in the `xprize_mcs` branches. |
| `archive/dev_RM` | 2025-04-11 `67f2af7f03` | Ron0Studios, Will Hunt | Risk heatmap and GeoJSON popups. Included in `proj_xPrize`. Its saturated allocator (`maxsumsaturated`, `taskGroupSize`) and multi-agent region coverage (`regionCoverage`) are now in Moongazer. |
| `archive/exp_ai_demo` | 2023-03-19 `cc62e31d6d` | Will Hunt | The AAMAS 2023 demo (best demo): image review with agents at an 80% classification rate, saturating re-allocation with max-sum, score calculation and score line, name logging. Includes `exp_resolutionStudy`. Ported: the scouting mode (`"scouting"` in a scenario, `ScoutingDemo.json`, showcase tile) with its image popup on the map, the level images now drawn as a blur in the browser instead of 120 stored PNGs. |
| `archive/exp_resolutionStudy` | 2022-12-06 `a27f479150` | Will Hunt | The resolution study (compressed scans, high-resolution revisits) was already in Moongazer from `temp_devmerge`; its scenarios are now `ResolutionStudy_*.json` with a showcase tile. The last commit, region tasks that complete and resume cleanly, is Moongazer's `regionCoverage`. |
| `archive/exp_exSwarm` | 2022-10-12 `1aa24780cb` | Will Hunt | eXSwarm study: multi-image scans (1, 2x2 and 3x2 sets) in the review window. |
| `archive/dev_jobAllocation` | 2022-04-07 `cd3c34b46e` | Will Hunt | Package delivery scenario with scout and shuttle agents, hazard detection and rerouting, A* path finding. Not ported: the predictive fleet management delivery mission covers this ground. |
| `archive/master` | 2023-04-26 `b8b0fe08fe` | Yash Brid, Mohammad Soorati | The old default branch: the 2021 HutSim base plus Yash Brid's 2023 Gradle migration, Dockerfile and docker-compose, unit tests (Coordinate, Simulator, MessagePublisher, QueueManager), and the MIT `LICENSE` (2022, Mohammad D. Soorati). Moongazer has its own Gradle and Docker set-up; its MIT `LICENSE` is now at the repository root; the unit tests were not carried over. |
