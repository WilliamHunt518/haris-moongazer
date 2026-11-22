# REST API

The browser client talks to the server only through these endpoints, and they are also handy for scripting: the CI smoke test, `tools/record_replay.py` and study set-up all use them.

- The server listens on port **44101** by default.
- POST parameters are form-encoded (`application/x-www-form-urlencoded`), as `curl -d` and jQuery's `$.post` send them.
- A missing required parameter returns **400**. An unknown id returns **404**. Success is **200** unless noted.
- `<id>` stands for an object id, such as `UAV-3` or `Task-12`. `[param]` is optional.

For example:

```bash
curl -X POST -d 'file-name=AllUITest.json' http://localhost:44101/mode/scenario
curl -X POST http://localhost:44101/mode/scenario/start
curl http://localhost:44101/state.json
```

The handlers are in `server/src/server/controller/handler/`, one per URL prefix.

## State

| Method | Path | Params | Description |
|---|---|---|---|
| GET | `/state.json` | | The whole simulation state as JSON. The client polls this. |
| GET | `/visualizer` | | Agents and tasks only, as two JSON lines. |
| POST | `/reset` | | Reset the server to an empty state. |

## Mode and scenarios (`/mode`)

| Method | Path | Params | Description |
|---|---|---|---|
| GET | `/mode/scenario-list` | | Scenarios at the top level of `web/scenarios/`, as a JSON array of `{fileName, gameId}`. |
| GET | `/mode/in-progress` | | Whether a mission is running. |
| POST | `/mode/sandbox` | | Start the sandbox. |
| POST | `/mode/scenario` | `file-name` | Load a scenario. The path is relative to `web/scenarios/` and may include a subfolder. **400** if it can't be loaded. |
| POST | `/mode/scenario/start` | | Start the loaded scenario's clock. |
| POST | `/mode/scenario/registerUser` | `userName` | Register a participant. Their actions are logged to `<userName>-<gameId>.log`. |
| POST | `/mode/timing` | `[speed]`, `[tickRate]` | Change simulation speed (0.25 to 8) and tick rate (2 to 30 Hz). At least one is required. Returns the values now in effect as JSON, `{"speed": 1.0, "tickRate": 10.0}`. |
| POST, GET | `/preset/scenario` | `file-name` | Load a scenario and redirect the browser to the operator interface. For participant links. |

## Agents (`/agents`)

| Method | Path | Params | Description |
|---|---|---|---|
| POST | `/agents` | `lat`, `lng`, `heading` | Add a virtual agent (sandbox). **201**. |
| POST | `/agents/<id>` | `[speed]`, `[altitude]` | Change an agent's speed or altitude. |
| POST | `/agents/time-out/<id>` | `timedOut` | Simulate a communication loss (`true`) or its end (`false`). Virtual agents only. |
| POST | `/agents/route/add/<id>` | `index`, `lat`, `lng` | Insert a point into an agent's route. |
| POST | `/agents/route/edit/<id>` | `index`, `lat`, `lng` | Move a point in an agent's route. |
| DELETE | `/agents/route/<id>` | `index` | Remove a point from an agent's route. |
| DELETE | `/agents/<id>` | | Remove a virtual agent. |
| POST | `/agents/hubspawn` | | Launch one more agent from the hub (the PFM Add button). **201**. |
| POST | `/agents/hubdespawn` | | Schedule an agent's return and removal (the PFM Remove button). **201**. |

## Tasks (`/tasks`)

| Method | Path | Params | Description |
|---|---|---|---|
| POST | `/tasks` | `type`, `lat`, `lng` | Create a point task. Types: `0` waypoint, `1` monitor, `4` deep scan, `5` shallow scan, `6` visit. **201**. |
| POST | `/tasks/patrol` | `path` | Create a patrol task from a comma-separated list of coordinates. **201**. |
| POST | `/tasks/patrol/update/<id>` | `path` | Replace a patrol task's path. |
| POST | `/tasks/region` | `corners` | Create a region task from its corners. **201**. |
| POST | `/tasks/region/update/<id>` | `corners` | Replace a region task's corners. |
| POST | `/tasks/<id>` | `[lat]`, `[lng]`, `[group]`, `[priority]` | Move a task or change its group or priority. |
| DELETE | `/tasks/<id>` | | Delete a task. |

## Allocation (`/allocation`)

These change the temporary allocation, except `confirm`, which makes it the main allocation. See [Allocation](architecture.md#allocation).

| Method | Path | Params | Description |
|---|---|---|---|
| POST | `/allocation/auto-allocate` | | Run the scenario's planner and put its result in the temporary allocation. |
| POST | `/allocation/allocate` | `agentId`, `taskId` | Assign one agent to one task. |
| POST | `/allocation/groupAllocate` | `agentIds`, and `taskIds` or `taskGroupIndex` | Assign a group of agents to a group of tasks (comma-separated ids), or to every task in a spawn batch, and confirm. Used by the `dynamic` and `teams` heatmaps. |
| POST | `/allocation/teamAllocate` | `agentIds`, and `taskGroup` or `taskIds` | Allocation lens: send a team to a mission and confirm at once (see `heatmapUI` in the scenario reference). With neither, the team is released. Logged as `TMAL`. |
| POST | `/allocation/restore` | | Allocation lens: undo the latest `teamAllocate`, putting those drones back on their previous tasks and queues. Logged as `TMUN`. |
| POST | `/allocation/confirm` | | Make the temporary allocation the main allocation. Agents set off. |
| POST | `/allocation/undo` | | Undo the last change to the temporary allocation. |
| POST | `/allocation/redo` | | Redo it. |
| POST | `/allocation/reset` | | Throw away the temporary allocation and start again from the main one. |
| DELETE | `/allocation/<id>` | | Remove an agent's allocation. |

## Targets, scans and review

| Method | Path | Params | Description |
|---|---|---|---|
| POST | `/targets` | `lat`, `lng`, `type` | Add a target (`0` human, `1` adjustable). **201**. |
| POST | `/targets/reveal/<id>` | | Make a hidden target visible. |
| POST | `/targets/requestImage/<id>` | | Ask for a scan image of a target. |
| DELETE | `/targets/<id>` | | Delete a target. |
| POST | `/review/classify` | `ref`, and `priority` or `status` | Record the operator's review of a scan: a triage priority, or whether it is a true find. |
| POST | `/review/report/workload` | `level` | Record the workload slider level (1 to 5). |

## Interface

| Method | Path | Params | Description |
|---|---|---|---|
| POST | `/ui/toggle` | `name`, `status` | Turn a [UI option](scenarios.md#interface-options) on or off. **400** if the scenario doesn't declare it. |
| POST | `/changeview` | `edit` | Switch mode: `1` monitor, `2` edit. |

## Legacy

These remain from HutSim and the real-drone link. They are kept but are not used by the Moongazer interface. See [real drones and manual control](legacy/real-drones.md).

| Method | Path | Params | Description |
|---|---|---|---|
| POST | `/register` | `lat`, `lon` | Register a real drone. |
| POST | `/teleop` | `linear`, `angular`, `id` | Drive an agent directly. |
| POST | `/ardrone_pos` | `id`, `x`, `y`, `a` | Set an AR.Drone's position. |
| POST | `/configjson` | `agent` | Save agents as a starting configuration. |
| POST | `/provdoc` | `id` | Set the ProvStore document id. ProvStore upload is disabled. |
| POST | `/logger` | | Not implemented. |
