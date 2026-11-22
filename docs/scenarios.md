# Scenario reference

A scenario is a JSON file in `server/web/scenarios/` that sets up one mission: the map, the agents, what the operator has to find or do, which interface features are on, and how the swarm is allocated. Study conditions are usually several scenario files that differ in one or two fields.

Files at the top level of `scenarios/` appear in "Browse all scenarios" on the launch page. Files in subfolders still load by their relative path (for example `CurrentNonFixed/DynamicTaskingShiftHeatmap.json`) from a showcase tile, from `POST /mode/scenario`, or from another scenario's `nextScenarioFile`.

Every field except `gameId`, `gameDescription` and `gameCentre` is optional. The fields below are the ones the server reads, checked against `Simulator.loadScenarioFromFile` in `server/src/server/Simulator.java`. Anything else in a file (such as `comment`) is ignored.

- [A minimal scenario](#a-minimal-scenario)
- [Mission](#mission)
- [Agents, hub and objects](#agents-hub-and-objects)
- [Allocation and autonomy](#allocation-and-autonomy)
- [Interface options](#interface-options)
- [Uncertainty, noise and communication](#uncertainty-noise-and-communication)
- [Predictive fleet management](#predictive-fleet-management)
- [Dynamic tasks and abstraction](#dynamic-tasks-and-abstraction)
- [Session flow and logging](#session-flow-and-logging)
- [Fields that are no longer read](#fields-that-are-no-longer-read)

## A minimal scenario

```json
{
  "gameId": "Find the casualties",
  "gameDescription": "A fire has been reported north of Southampton Common. Use your three drones to find the people nearby.",
  "gameCentre": { "lat": 50.9294, "lng": -1.4080 },
  "timeLimitSeconds": 300,
  "allocationMethod": "maxsum",
  "allocationStyle": "manualwithstop",
  "uIOptions": [
    { "name": "uncertainties", "default": false, "toggleable": true },
    { "name": "ranges",        "default": false, "toggleable": true }
  ],
  "agents": [
    { "lat": 50.9288, "lng": -1.4095 },
    { "lat": 50.9294, "lng": -1.4078, "battery": 0.5 },
    { "lat": 50.9301, "lng": -1.4066 }
  ],
  "hazards": [ { "lat": 50.9323, "lng": -1.4091, "type": 0 } ],
  "targets": [
    { "lat": 50.9299, "lng": -1.4084, "type": 0 },
    { "lat": 50.9292, "lng": -1.4116, "type": 0 }
  ]
}
```

The scenarios in `server/web/scenarios/` are working examples. `AllUITest.json` turns on every lens, `usecase.json` uses scan review and ground vehicles, `ProggedNoCom.json` uses programmed agents and a hub, and the `PFM_*.json` files are the predictive fleet management conditions.

## Mission

| Field | Type | Default | Meaning |
|---|---|---|---|
| `gameId` | string | required | The scenario's name. Shown to the operator and used in log file names. Should be unique. |
| `gameDescription` | string | required | Text shown before the scenario starts. May contain simple HTML such as `<br />`. |
| `gameCentre` | `{lat, lng}` | required | The map centre at the start. |
| `timeLimitSeconds` | number | none | Ends the scenario after this many simulated seconds. |
| `timeLimitMinutes` | number | none | The same in minutes. If both are set, `timeLimitMinutes` wins. With neither, there is no time limit. |
| `tickRate` | number | 10 | Engine updates per simulated second, from 2 to 30. Use 5 for the original feel. The operator can change it with the slider. |
| `simSpeed` | number | 0.5 | Starting speed in simulated seconds per real second, from 0.25 to 8. The study scenarios set 1.0 so they run in real time. The operator can change it with the slider. |

## Agents, hub and objects

### `agents`

An array of the drones the operator starts with.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `lat`, `lng` | number | required | Starting position. |
| `battery` | number | 1.0 | Starting battery, from 0 to 1. |
| `mkr` | string | `"UAV"` | Marker to draw: `"UAV"` (in the Modern look a quadrotor), `"UAVQuad"`, `"UAVFixedWing"`, `"UGV"`, or a team colour `"UAV-blue"` (also cyan, green, orange, pink, purple, red, yellow). The Classic look draws every UAV type with its original plane icon. Icons live in `server/web/icons/modern/`; see [tools/icons](../tools/icons/). |
| `programmed` | boolean | false | Run this agent's behaviour from a drone programmer policy instead of the central planner. Programmed agents need a `hub`. |
| `policy` | string | `"GenericAgentPolicy"` | The policy class for a programmed agent: `GenericAgentPolicy` or `UseCasePolicy`. See [the drone programmer](architecture.md#the-drone-programmer). |

### `hub`

`{lat, lng}`: the base station. Programmed agents and communication-constrained missions relay what they know through it, and PFM missions launch and recharge drones there. Without programmed agents or communication limits, it is a plain hub agent on the map.

### `hazards`

| Field | Type | Meaning |
|---|---|---|
| `lat`, `lng` | number | Position. |
| `type` | number | `0` fire, `1` debris. |
| `size` | number | Optional size of the hazard area. |

Hazards are not drawn as markers. Agents that pass close to one record a detection, and the detections build the hazard heatmap (the `hazard` lens).

### `targets`

Things the operator has to find. All targets start hidden and appear when an agent gets close enough.

| Field | Type | Meaning |
|---|---|---|
| `lat`, `lng` | number | Position. |
| `type` | number | `0` human, `1` adjustable (a target whose scan image the operator reviews). |
| `real` | boolean | For adjustable targets: whether this is a true positive. Setting it makes the target reviewable. |
| `lowRes`, `highRes` | string | Image files for the scan, relative to `server/web/images/`. |

In a [scouting](#progressive-resolution-scouting) scenario, adjustable targets start visible and each gets its own task.

### `tasks`

Tasks that exist from the start.

| Field | Type | Meaning |
|---|---|---|
| `lat`, `lng` | number | Position. |
| `type` | number | `0` waypoint, `1` monitor, `4` deep scan, `5` shallow scan, `6` visit. |

Patrol and region tasks (types 2 and 3) need a path, so they can be created in the interface but not in a scenario file.

### `markers`

Shapes drawn on the map for context, such as a search area.

| Field | Type | Meaning |
|---|---|---|
| `shape` | string | The shape, for example `"circle"`. |
| `centreLat`, `centreLng` | number | Centre. |
| `radius` | number | Radius in metres. |

In a [degradation study](#swarm-degradation-study) episode, `markers` can also hold `{"shape": "banner", "text": "...", "colorBg": "#ffcc00", "colorTxt": "#000"}` (a message across the top of the map) and `{"shape": "textMarker", "lat": ..., "lng": ..., "text": "..."}` (a large label on the map). They show for that episode only.

## Allocation and autonomy

| Field | Values | Default | Meaning |
|---|---|---|---|
| `allocationMethod` | `maxsum`, `maxsumsaturated`, `random`, `maxsumwithoverspill`, `bestfirst`, `basicbundle`, `heuristicbundle`, `cbaa`, `cbba`, `cbbacoverage` | `maxsum` | The planner behind auto-allocation. An unknown value falls back to `maxsum` with a warning. |
| `taskGroupSize` | integer | none | Maximum agents per patrol or region task created during the mission. Use it with `maxsumsaturated`, which puts every free agent to work, sharing them between tasks in proportion to each task's length. |
| `regionCoverage` | boolean | `false` | Region tasks are split between their agents, starting at evenly spaced points along the sweep, and complete once every point has been swept. Without it a region is patrolled until the operator removes it. Example: `Testing/SaturatedRegions.json`. |
| `allocationStyle` | `manual`, `manualwithstop`, `dynamic`, `bundle` | `manualwithstop` | How much the operator controls. `manual`: the operator assigns or confirms, and agents keep moving while they edit. `manualwithstop`: the same, but agents hold position in edit mode. `dynamic`: free agents take the next task themselves. `bundle`: agents are allocated bundles of tasks. |
| `flockingEnabled` | boolean | false | Agents without a task follow their neighbours' average speed and heading, instead of stopping. |
| `deepAllowed` | boolean | false | Lets the operator request deep (high-resolution) scans. |

## Interface options

### `uIOptions`

Every optional part of the interface is declared here. Each entry has a `name`, a `default` (on or off at the start) and `toggleable` (whether the operator gets a control for it). An option that is not listed is off and has no control.

```json
"uIOptions": [
  { "name": "uncertainties", "default": true,  "toggleable": false },
  { "name": "ranges",        "default": false, "toggleable": true }
]
```

| Name | What it controls |
|---|---|
| `monitor` | The monitor-mode button. |
| `editmode` | The edit-mode button. Leave it out to keep the operator in one mode. |
| `uncertainties` | Lens: a circle of possible true positions around each agent. Size from `uncertaintyRadius`. |
| `ranges` | Lens: each agent's communication range. Size from `communicationRange`. |
| `predictions` | Lens: predicted paths. |
| `explored` | Lens: a heatmap of recently explored areas, which fades over time. |
| `hazard` | Lens: the heatmap of detected hazards. |
| `scans` | The scan button group. |
| `scanButtons` | The buttons to request scans. |
| `reviewPanel` | The scan review panel and image viewer. |
| `triageButtons` | High, medium and low triage buttons in the review panel. |
| `workloadSlider` | The five-level abstraction and workload slider. |
| `verification` | The estimated completion time panel in PFM missions. Off in the PFM control conditions. |

PFM missions also always get the mission cost panel and the add and remove drone buttons.

### Other interface fields

| Field | Type | Meaning |
|---|---|---|
| `reviewPanel` | boolean | Shows the scan review panel. Used with the `reviewPanel` UI option in the triage scenarios. |
| `dynamicUIFeatures` | object | See [Dynamic tasks and abstraction](#dynamic-tasks-and-abstraction). |

## Uncertainty, noise and communication

| Field | Type | Default | Meaning |
|---|---|---|---|
| `uncertaintyRadius` | number | 10 | Radius in metres of the position-uncertainty lens. |
| `communicationRange` | number | 250 | Radius in metres within which agents can communicate. |
| `communicationConstrained` | boolean | false | Agents only share what they know within communication range, and the operator sees last known positions relayed through the hub. |
| `varianceParameters` | object | none | Fixed differences between agents, drawn once per agent from [−value, value]: `speedPerAgent`, `batteryPerAgent`. |
| `noiseParameters` | object | none | Random noise drawn every step from [−value, value]: `speedPerSecond`, `batteryPerStep`, `locationNoise`. |

## Predictive fleet management

A `verificationParameters` block turns a scenario into a PFM delivery mission. PFM missions run in monitor mode only, and use the study's original movement and battery model unless `legacyStudyPhysics` is set to `false`.

```json
"modelStyle": "parallel",
"verificationParameters": {
  "isEnabled": true,
  "isDummy": false,
  "samples": 100,
  "autoRunFrequency": 30,
  "delayTime": 15,
  "delayBound": 5
}
```

| Field | Type | Meaning |
|---|---|---|
| `isEnabled` | boolean | Run the model checker at all. |
| `isDummy` | boolean | Placebo predictor: instead of calling PRISM, wait `delayTime` ± `delayBound` seconds and return a plausible random estimate. Used for the placebo study condition. |
| `samples` | number | Number of simulation samples PRISM uses for each estimate. |
| `autoRunFrequency` | number | Re-run the models every this many simulated seconds, as well as after each add or remove. |
| `delayTime`, `delayBound` | number | Placebo delay, in seconds. |
| `modelStyle` (top level) | string | `parallel` runs three models together: the current swarm, one drone fewer and one drone more, which is what the add and remove buttons show. `series` runs them one after another. |
| `legacyStudyPhysics` (top level) | boolean | Default `true` for PFM missions: use the movement speed and battery drain of the original study, so results stay comparable. |

Live estimates need PRISM. See [Getting started](getting-started.md#prism-for-predictive-fleet-management).

## Progressive-resolution scouting

A `scouting` block turns a scenario into the AAMAS 2023 demo (Hunt et al., *Demonstrating Performance Benefits of Human-Swarm Teaming*). Every adjustable target is visible from the start and gets a scouting task. Clicking a target opens a popup on the map with its image and Casualty / No Casualty buttons, as in the original demo; there is no scans window. Use it with `"allocationStyle": "dynamic"`: a free drone takes the nearest unclaimed target, or doubles up on the nearest one once all are claimed. As a drone closes in, the target's image sharpens. The operator can classify a target early from that popup; otherwise the drone classifies it on arrival. The score, shown on the map and at the end, is correct finds per minute × accuracy × 100, and is logged as `DEMOSCORE`. Example: `ScoutingDemo.json`.

```json
"scouting": { "agentAccuracy": 0.8, "metresPerLevel": 50, "maxLevel": 9, "agentSpeed": 4.0 }
```

| Field | Type | Default | Meaning |
|---|---|---|---|
| `agentAccuracy` | number | `0.8` | Chance that a drone classifies a target correctly on arrival. |
| `metresPerLevel` | number | `50` | Distance per resolution level: the image is at level `floor(distance / metresPerLevel)`, capped at `maxLevel`, and never gets blurrier again. |
| `maxLevel` | number | `9` | Starting (blurriest) level. Level 0 is full resolution. |
| `agentSpeed` | number | engine default | Speed of every drone, in metres per second. |

## Swarm degradation study

An `episodes` list turns a scenario into Will Hunt's swarm degradation study (ported from the `exp_degradation_coloured` branch; see the [archive index](legacy/branches.md)). Each episode clears the map and shows `numAgents` colour-coded drones: one leader flies off and the rest flock after it. `degradationTime` seconds in, one drone of colour `degColour` disappears without any notice, and the participant presses **Space** (or the button) as soon as they see it. Episodes follow each other straight away and the scenario ends after the last one. The view is a fixed satellite map with drone ids hidden, and the study runs at its original 15 ticks per second.

Scenarios: `Degradation_Tutorial.json` (6 episodes and a questionnaire at the end) and `Degradation_A.json` to `Degradation_D.json` (the four counterbalanced 76-episode decks, about nine minutes each). They log by participant id: the page asks for the id when the scenario opens.

```json
"episodes": [
  { "episodeLength": 7.0, "numAgents": 12, "degradationTime": 5,
    "colours": ["blue", "green", "yellow", "red", "red", "yellow", "blue", "green", "red", "yellow", "blue", "green"],
    "degColour": "yellow", "prevAgents": 0, "episodeCode": "EP-0-12-y-5" }
]
```

| Episode field | Type | Default | Meaning |
|---|---|---|---|
| `episodeLength` | number | `7` | Seconds the episode lasts. |
| `numAgents` | number | `8` | Drones in the episode. |
| `degradationTime` | number | none | Seconds in when one drone disappears. Leave it out for an episode with no disappearance. |
| `colours` | list | red, green, blue, yellow repeated | One colour per drone, the leader first: `blue`, `cyan`, `green`, `orange`, `pink`, `purple`, `red` or `yellow`. |
| `degColour` | string | any | Colour of the drone that disappears. A free drone of that colour is removed; if none is left, any free drone. |
| `prevAgents` | number | `0` | Swarm size of the previous episode, for the log only. |
| `episodeCode` | string | `EP-<n>` | Code written to the log and sent as the LSL marker. The generator writes `EP-<prev>-<n>-<colour initial>-<time>`. |
| `agentPos`, `targetPos` | string | `C`, `R` | Where the leader starts and which way it heads: `C`, `T`, `B`, `L`, `R`, `TL`, `TR`, `BL` or `BR`, around `gameCentre`. |
| `markers` | list | none | Banners, text or circles shown during this episode (see [`markers`](#markers)). |

| Scenario field | Type | Default | Meaning |
|---|---|---|---|
| `episodeReview` | string | `"none"` | `"each"` or `"end"` shows a questionnaire after every episode or after the last one: how mentally demanding it was and how confident the participant is, each 1 to 7 (logged as `WKLD` and `PRCP`). |
| `motionScale` | number | `1` | Multiplies how far drones move and turn per tick. The study files use `5`, which matches the speed the study ran at (`gameSpeed` 25 on the old engine). |
| `complexFlocking` | boolean | `false` | Tighter spacing (150 m instead of 250 m) and more heading noise (±20° instead of ±10°). |
| `lslMarkers` | boolean | `false` | Sends each episode code, `DEG` (disappearance), `CLTT`/`CLTF` (press after or before it), `REVIEW` and `END` on a Lab Streaming Layer outlet named `OxysoftMarkers`, for fNIRS or EEG recordings. Needs liblsl installed: put it on the library path or set `HARIS_LSL_LIB` to the file. Without it the run carries on with no markers. |
| `recordEpisodes` | boolean | `false` | Records the screen with ffmpeg and cuts one clip per episode into `log/recordings/<gameId>/`. Needs `HARIS_FFMPEG` (path to ffmpeg); the capture input defaults to `dshow` / `video=OBS Virtual Camera` on Windows, `avfoundation` on macOS and `x11grab` on Linux, and can be changed with `HARIS_FFMPEG_FORMAT` and `HARIS_FFMPEG_DEVICE`. |

**Log and results.** The log has `NEWEP` (episode start), `DEGTR` (drone removed), `DGCLK` (key press, with whether it was a hit and the reaction time in milliseconds), `DGNOC` (episode ended without a press), `EPEND`, and `EPSDONE` at the end. When the run ends, two CSV files are written next to the log: `<id>-<gameId>.episodes.csv` (one row per episode) and `<id>-<gameId>.summary.csv` (hits, misses, false presses, hit rate and mean reaction time per swarm size). To rebuild them: `./gradlew -q processStudyLogs -Plogs="P01-EpA.log P02-EpB.log"` from `server/`.

**New decks.** `./gradlew -q generateEpisodes -Pout=web/scenarios/eps/deck.json -Pseed=42` writes a balanced deck: swarm sizes 4, 8, 12, 16 and 20, every ordered pair of sizes appearing three times in one Eulerian tour (Hierholzer), colours balanced within each episode and disappearance times of 3, 4 or 5 seconds. It prints a check of all of this. Paste its `episodes` list into a copy of `Degradation_A.json`.

Not carried over from the branch: the earlier n-back and cooldown-style episode files (`nBack*.json`, `degShort.json`, `rampUpDown.json`, `High`/`LowComplexity.json`), which the branch's final code no longer ran, and the older generators. They are in the `archive/exp_degradation_coloured` tag.

## Dynamic tasks and abstraction

### `missionController`

Spawns new tasks while the mission runs, for workload studies.

```json
"missionController": {
  "spawnRadius": 1200,
  "taskSpawnTrack": [
    { "spawnTime": 0,  "spawnRate": 5 },
    { "spawnTime": 60, "spawnRate": 2 }
  ]
}
```

Waypoint tasks appear in small batches inside an elliptical area around the map centre, up to `spawnRadius` metres out. Each `taskSpawnTrack` entry sets a new rate, in tasks per minute, from `spawnTime` simulated seconds onwards.

### `dynamicUIFeatures`

Lists the interface features for each of the five workload slider levels, keyed `"1"` to `"5"`. The feature `"heatmap"` draws agents and tasks as cluster heatmaps at that level.

```json
"dynamicUIFeatures": {
  "1": [], "2": [], "3": ["heatmap"], "4": ["heatmap"], "5": ["heatmap"]
}
```

### `heatmapUI`

Chooses which heatmap allocation interface the `"heatmap"` feature uses. Each spawn batch from the `missionController` is one task group, called a mission in the interface.

| Value | Interface |
|---|---|
| `"dynamic"` (default) | The original heatmap. Agents and tasks are grouped by distance as they move, and the operator drags an agent cluster onto a task cluster. Scenarios without `heatmapUI` use it, so older study files run as before. |
| `"teams"` | The 2024 version from the `exp_fastpi` branch. Agents are put in fixed teams when the scenario loads, each team and each mission has its own heatmap and marker, and the operator drags an `AgentGroup` marker onto a `TaskGroup` marker. |
| `"lens"` | The allocation lens. Same teams and missions as `"teams"`, but each team has a colour and a letter that its heatmap, badge, arrows and covered tasks share. Each mission badge shows one pip per task (covered, queued or not covered). Arrow width is the number of drones going to that mission. Dragging a team snaps to the nearest mission and previews the outcome. The drop takes effect at once and can be undone. An allocation board beside the map shows the same information and takes the same drags. Hovering a team or mission shows which drone is on which task. Under the Classic look a `"lens"` scenario uses `"teams"` instead. |

`heatmapTeamSize` (number, default 3) sets the team size for `"teams"` and `"lens"`. Teams are formed from each agent and its nearest ungrouped neighbours, in scenario order. These two modes also spawn tighter batches that keep clear of other batches' tasks, as in the 2024 study. The examples are in `scenarios/Heatmap/`.

In the lens, a team dropped on a mission first takes the tasks that no other team covers, nearest drone first. If the mission has more tasks than the team has drones, the rest are queued on the nearest drone. Spare drones help on the tasks with the fewest drones. Dropping a team on "Teams without a mission" releases it.

## Session flow and logging

| Field | Type | Meaning |
|---|---|---|
| `nextScenarioFile` | string | The scenario that follows this one. When it ends, the end panel offers a button to continue to that file. Use it to chain a tutorial and study conditions. |
| `loggingById` | boolean | Marks the scenario as one that logs per participant. Register the participant with `POST /mode/scenario/registerUser` (see [Running a user study](getting-started.md#running-a-user-study)). |

## Fields that are no longer read

Older scenario files contain these. The server ignores them, so they do nothing:

| Field | Use instead |
|---|---|
| `extendedUIOptions` | `uIOptions` entries (`predictions`, `uncertainties`, `ranges`, `workloadSlider`) |
| `programmed` (top level) | `programmed` on each agent |
| `taskSpawnTrack`, `spawnRadius` (top level) | the same fields inside `missionController` |
