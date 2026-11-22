# Showcase and demo

HARIS has two front doors: the **launch page** of a running server, with a tile for each showcased feature, and the **website** on GitHub Pages, with an online demo that replays recorded runs in the real interface. This page describes both, the research behind each tile, and how to change them.

- [The showcase tiles](#the-showcase-tiles)
- [Published work](#published-work)
- [Adding or changing a tile](#adding-or-changing-a-tile)
- [The website and online demo](#the-website-and-online-demo)

## The showcase tiles

### Predictive fleet management

*Runtime formal modelling with PRISM.* A delivery mission with live estimates of when it will finish. While the mission runs, HARIS builds models of the current state and checks them with the PRISM probabilistic model checker, in parallel for the swarm as it is, one drone fewer and one drone more. The estimate is coloured against the deadline, and the Add and Remove buttons show how finish time and mission cost would change before you press them.

| Condition | File | What differs |
|---|---|---|
| Live PRISM | `PFM_SFV.json` | Real estimates, re-run every 30 s |
| Placebo predictor | `PFM_SDV.json` | Plausible but uninformative estimates, no PRISM |
| No prediction | `PFM_SNV.json` | No estimate panel |
| Tutorial | `PFM_Tutorial.json` | Practice mission |

The three study conditions differ only in their prediction settings. Live estimates need PRISM 4.8 ([setup](getting-started.md#prism-for-predictive-fleet-management)). From: Abioye, Hunt, Gu et al., ACM THRI 2025; Abioye et al., HRI Companion 2024; building on Gu, Hunt et al., RO-MAN 2023.

### Operator lenses

*Switchable situational-awareness overlays.* Turn map lenses on and off: position uncertainty, communication range, path prediction, and the explored and hazard heatmaps. Each scenario declares every lens with a default and whether the operator may toggle it, so one file can lock a lens on for one condition and off for another. File: `AllUITest.json`. From: Soorati, Naiseh, Hunt et al., 2024.

### Scan review and triage

*Human triage directing ground vehicles.* Drones scan the area and their images arrive for review. The operator triages each find as high, medium or low priority, and a team of programmed ground vehicles then serves the triaged targets in priority order with no further input. File: `usecase.json`. From: Soorati, Naiseh, Hunt et al., 2024.

### Progressive-resolution scouting

*Human-swarm teaming against the clock.* Five drones fly to twelve reported casualties, and each image in the review panel sharpens as a drone closes in. Classify a target as soon as you are sure and that drone moves on to the next one; leave it and the drone classifies it on arrival, correctly 80% of the time. Free drones are re-allocated continuously and double up once every target is taken. You have 90 seconds, scored on correct finds per minute times accuracy. File: `ScoutingDemo.json` ([settings](scenarios.md#progressive-resolution-scouting)). From: Hunt et al., AAMAS 2023 (best demo).

### Drone programmer

*Programmed agents under communication limits.* Each agent runs its own policy with only local knowledge, messaging and movement. With limited communication, the operator sees last known positions and the targets relayed back to the hub. Files: `ProggedNoCom.json` (limited comms), `ProggedWithCom.json` (full comms). From: Soorati, Naiseh, Hunt et al., 2024. See [the drone programmer](architecture.md#the-drone-programmer) to write your own policy.

### Adaptive abstraction

*Heatmaps that reduce operator workload.* A high-workload mission where agents and tasks are drawn as cluster heatmaps instead of individual markers. Drag a cluster of agents onto a cluster of tasks and HARIS turns that into individual assignments. In the full study a five-level slider moved between individual and abstract views, and workload was measured with fNIRS. File: `CurrentNonFixed/DynamicTaskingShiftHeatmap.json`. From: Abioye, Landowska, Hunt et al., 2024.

### Sandbox

An empty map with no objective. Add agents and tasks by hand to try features without writing a scenario.

## Published work

| Year | Work | Venue | HARIS features |
|---|---|---|---|
| 2025 | A User Study Evaluation of Predictive Formal Modelling at Runtime in Human-Swarm Interaction. Abioye, Hunt, Gu et al. | ACM Transactions on Human-Robot Interaction | Predictive what-if, cost panel, placebo predictor |
| 2024 | [Adaptive Human-Swarm Interaction based on Workload Measurement using fNIRS](https://arxiv.org/abs/2405.07834). Abioye, Landowska, Hunt et al. | arXiv | Heatmap abstraction, slider, cluster assignment |
| 2024 | The effect of predictive formal modelling at runtime on performance in human-swarm interaction. Abioye et al. | HRI Companion | Predictive what-if |
| 2024 | Enabling trustworthiness in human-swarm systems through a digital twin. Soorati, Naiseh, Hunt et al. | Putting AI in the Critical Loop (book chapter) | Lenses, scan review, triage to ground vehicles, drone programmer |
| 2023 | [Demonstrating Performance Benefits of Human-Swarm Teaming](https://arxiv.org/abs/2303.12390). Hunt et al. | AAMAS (best demo) | Progressive-resolution scouting, continuous re-allocation, score |
| 2023 | Successful swarms: Operator situational awareness with modelling and verification at runtime. Gu, Hunt et al. | RO-MAN | Runtime PRISM models, delivery and battery |
| 2023 | [The Effect of Data Visualisation Quality and Task Density on Human-Swarm Interaction](https://arxiv.org/abs/2307.08590). Abioye, Naiseh, Hunt et al. | RO-MAN | On-demand high-resolution revisit |

HARIS builds on HutSim, the simulator behind Ramchurn et al., IJCAI 2015.

## Adding or changing a tile

The tiles come from one file, `server/web/showcase/showcase.json`, so adding a showcase needs no code.

```json
{
  "id": "lenses",
  "title": "Operator lenses",
  "showcasing": "Switchable situational-awareness overlays",
  "description": "Turn map lenses on and off: ...",
  "image": "showcase/img/overview.webp",
  "file": "AllUITest.json",
  "variants": [
    { "label": "Condition A", "file": "ConditionA.json" },
    { "label": "Condition B", "file": "ConditionB.json" }
  ],
  "papers": [
    { "cite": "Soorati, Naiseh, Hunt et al.", "venue": "Putting AI in the Critical Loop (book chapter)", "year": 2024 }
  ],
  "note": "Optional line shown under the tile, e.g. a requirement."
}
```

| Field | Meaning |
|---|---|
| `id` | A short unique name. |
| `title`, `showcasing`, `description` | The tile's heading, subheading and text. |
| `image` | A 16:10 image, relative to `server/web/`. Put new images in `server/web/showcase/img/`. WebP keeps them small. |
| `file` | The scenario the tile launches, relative to `server/web/scenarios/`. |
| `variants` | Optional. One chip per study condition; the chosen chip's file replaces `file`. |
| `papers` | Optional. Shown on the tile as citations. |
| `note` | Optional. A short requirement or caveat. |

CI checks every tile: each image must be served and each scenario file (including every variant) must load. Run the server and open the launch page to see the result.

## The website and online demo

The website is published at <https://williamhunt518.github.io/haris-moongazer/>. It has two parts:

- **The showcase site** at the root, from `site/` (a single `index.html` and `site/img/`).
- **The online demo** under `app/`, which is the real browser client from `server/web/` running in replay mode. Instead of talking to a server, it plays back a recorded run, so it works on static hosting. Visitors can watch, pan, zoom and toggle lenses, but cannot steer the mission.

### Replay mode

`sandbox.html?replay=<id>` loads `replays/<id>.json.gz` and answers the interface's requests from the recording: `state.json` returns the recorded state at the current playback time (agent positions are interpolated between frames), and everything else is accepted and ignored. Replay mode also works against a live server, which is handy for checking a recording.

Recordings live in `server/web/replays/`, with an `index.json` listing them.

### Re-recording the demo

With a server running (and PRISM set up, for the live PFM condition):

```bash
cd server && PRISM_HOME=/path/to/prism-4.8 ./gradlew run     # in one terminal
tools/record_showcase.sh                                     # in another, from the repository root
```

`tools/record_showcase.sh` records every showcase scenario listed inside it and rewrites `index.json`. Each line there gives the scenario file, the replay id, how many simulated seconds to record, the operator, and the recording speed.

To record a single run, use `tools/record_replay.py` directly:

```bash
python3 tools/record_replay.py --file AllUITest.json --id lenses --seconds 120 \
    --operator targets --speed 4 --out server/web/replays
```

`--operator targets` adds a scripted operator: two seconds in, it places a waypoint on every target (or a ring of waypoints when there are no targets), runs auto-allocation and confirms it, and repeats the allocation every `--allocate-every` seconds. PFM missions allocate themselves, so they use `--operator none`. The recording stores the full state in the first frame and only the changed top-level keys after that, sampled at `--hz` frames per simulated second.

### Publishing

`.github/workflows/pages.yml` runs `tools/build_pages.sh` on every push to `moongazer` and deploys the result. The script copies `site/` to the root of `_site/` and `server/web/` to `_site/app/`, switches the launch page into demo mode, and fills in the Maps key.

One-time setup in the repository settings:

1. **Settings → Pages → Source: GitHub Actions.**
2. **Settings → Secrets and variables → Actions:** add `HARIS_MAPS_KEY_PAGES`, a Maps key restricted by HTTP referrer to `https://<owner>.github.io/*`. Without it the site still builds, but the demo map shows Google's error instead of tiles.

To preview locally, run `tools/build_pages.sh` and serve `_site/` with any static server, for example `python3 -m http.server -d _site`.
