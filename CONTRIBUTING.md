# Contributing to HARIS Moongazer

Thanks for helping. HARIS is research software used in user studies, so the main rule is that a change must never silently alter how an existing study scenario behaves.

## Branches

- **`moongazer`** is the maintained branch. Work on a feature branch and open a pull request into `moongazer`.
- The other branches are the original research branches, kept unchanged as an archive. Don't push to them, and don't delete them.
- This repository is a fork of the lab's `SooratiLab/haris`. When opening a pull request, check that its base is `WilliamHunt518/haris-moongazer` and `moongazer`, since GitHub may offer the upstream repository by default.

## Building and checking

From `server/`:

```bash
./gradlew installDist       # compile
./gradlew run               # run on http://localhost:44101
```

There is no unit test suite yet. CI (`.github/workflows/ci.yml`) runs on every pull request and:

1. fails if anything that looks like a Google API key is in a tracked file,
2. builds the server,
3. starts it, loads a scenario, and checks the Maps key placeholder is filled in,
4. checks that every launch page tile's image is served and every tile scenario (with all its variants) loads.

Before opening a pull request, run the server, open the scenarios your change touches in both the Modern and Classic looks, and check the browser console for errors.

## Rules for changes

**New behaviour goes behind a scenario option.** Add an optional field to the scenario format whose default keeps the old behaviour, and document it in [docs/scenarios.md](docs/scenarios.md). Existing study scenarios must behave as they did, so their results stay comparable with the published work. The same goes for the interface: optional parts are [UI options](docs/scenarios.md#interface-options) the scenario declares.

**Keep the Classic look intact.** Moongazer styling lives in `server/web/theme/` and is switched off in Classic. Markup that only exists in the Modern look gets the class `mg-modern-only`.

**Scale per tick.** Anything that changes over time in the simulation (movement, battery, probabilities, timeouts) should use `Simulator.getTickFraction()` so behaviour is the same at any tick rate.

**Never commit secrets.** No Maps keys, API keys or passwords in code, scenarios, logs, screenshots or docs. Pages use the `%HARIS_MAPS_KEY%` placeholder; local keys go in the git-ignored `server/config.properties` or an environment variable.

**Keep logs useful.** Operator actions should be logged in the existing `time; CODE; description; values` format, so study analyses keep working.

## Common tasks

| Task | Where to look |
|---|---|
| Add a scenario field | `Simulator.loadScenarioFromFile`, `State`, then [docs/scenarios.md](docs/scenarios.md) |
| Add an endpoint | a handler in `server/src/server/controller/handler/`, then [docs/api.md](docs/api.md) |
| Add a planner | its own package, then `Allocator` and the `allocationMethod` list in `Simulator` |
| Add a drone policy | [The drone programmer](docs/architecture.md#the-drone-programmer) |
| Add a launch page tile | [Adding or changing a tile](docs/showcase.md#adding-or-changing-a-tile) |
| Re-record the online demo | [Re-recording the demo](docs/showcase.md#re-recording-the-demo) |

## Style

- Java: follow the surrounding code. Java 21 features are fine.
- JavaScript: the client has no build step and targets current browsers; keep to the existing jQuery and Backbone patterns rather than adding a framework.
- Documentation: plain English, short sentences, and update the relevant page in `docs/` in the same pull request as the change.
