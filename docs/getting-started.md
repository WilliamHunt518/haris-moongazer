# Getting started

This guide takes you from a fresh clone to a running simulator, then covers the options you need for demos and user studies.

- [Requirements](#requirements)
- [Run it](#run-it)
- [The Google Maps key](#the-google-maps-key)
- [PRISM, for predictive fleet management](#prism-for-predictive-fleet-management)
- [Docker](#docker)
- [Using the interface](#using-the-interface)
- [Running a user study](#running-a-user-study)
- [Troubleshooting](#troubleshooting)

## Requirements

| | |
|---|---|
| **Java** | A JDK, 17 or newer, to start Gradle. The build itself uses Java 21, which Gradle downloads automatically if you don't have it. |
| **Google Maps key** | A Maps JavaScript API key of your own. See [The Google Maps key](#the-google-maps-key). |
| **Browser** | A current Chrome, Firefox or Edge. |
| **PRISM 4.8** | Optional. Only needed for live predictions in predictive fleet management. |
| **Docker** | Optional, as an alternative to installing Java. |

HARIS runs on Windows, macOS and Linux.

## Run it

```bash
git clone -b moongazer https://github.com/WilliamHunt518/haris-moongazer
cd haris-moongazer/server
export HARIS_MAPS_KEY=<your-key>     # Windows PowerShell: $env:HARIS_MAPS_KEY="<your-key>"
./gradlew run                        # Windows: gradlew.bat run
```

Open <http://localhost:44101>. The first run takes a minute or two while Gradle downloads itself, Java 21 and the two library dependencies.

Always run Gradle from the `server/` folder. The simulator finds `web/`, the logging configuration and `config.properties` relative to its working directory, and `./gradlew run` sets that to `server/`.

**Another port:** pass it as the first argument.

```bash
./gradlew run --args=8000
```

**A standalone copy:** `./gradlew installDist` builds a runnable copy in `server/build/install/haris-moongazer/`. Start it from `server/` so it can find `web/`:

```bash
./gradlew installDist
build/install/haris-moongazer/bin/haris-moongazer          # Windows: build\install\haris-moongazer\bin\haris-moongazer.bat
```

JVM options for the standalone copy go in `JAVA_OPTS`, for example `JAVA_OPTS="-Dprism.home=/opt/prism-4.8"`.

## The Google Maps key

The browser client draws everything on Google Maps, so it needs a [Maps JavaScript API key](https://developers.google.com/maps/documentation/javascript/get-api-key). Without one the server still runs, but the map shows Google's error page instead of tiles.

Restrict the key in the Google Cloud console:

- **Application restriction:** HTTP referrers, for example `http://localhost:44101/*` (add the address of any machine you serve from).
- **API restriction:** Maps JavaScript API.

The server looks for the key in this order:

1. the environment variable `HARIS_MAPS_KEY`
2. the Java system property `haris.maps.key` (`-Dharis.maps.key=...`)
3. `maps.key` in `server/config.properties`

To use the file, copy `server/config.example.properties` to `server/config.properties` and fill in `maps.key=`. The file is git-ignored. If you add the key to the file while the server is running, the next page load picks it up.

HTML pages contain the placeholder `%HARIS_MAPS_KEY%`, which the server replaces as it serves each page. The key is never logged, never written to disk by HARIS, and must never be committed: CI fails the build if anything that looks like a Google API key appears in a tracked file.

## PRISM, for predictive fleet management

The live condition of predictive fleet management (`PFM_SFV.json`) builds probabilistic models of the mission while it runs and checks them with the [PRISM model checker](https://www.prismmodelchecker.org/). Everything else, including the placebo and no-prediction PFM conditions, runs without PRISM.

1. Download and install **PRISM 4.8** for your platform from the PRISM website. On Linux and macOS, run PRISM's own `install.sh` in its folder.
2. Tell HARIS where it is. Either set `PRISM_HOME` before `./gradlew run` (Gradle passes it on as `-Dprism.home`):

   ```bash
   export PRISM_HOME=/path/to/prism-4.8
   ./gradlew run
   ```

   or unpack PRISM to `server/libs/prism-4.8`, which is where HARIS looks by default.

On Windows, HARIS starts PRISM's Java class directly rather than through `prism.bat`, so PRISM does not need to be on your `PATH`. On Linux and macOS it runs `<prism.home>/bin/prism`.

The models PRISM generates and its results are written to `server/web/verification/` at run time and are git-ignored. Only the templates and the property file there are tracked.

`server/libs/prism-4.7-linux64` is an uninstalled PRISM 4.7 kept from the original repository. HARIS does not use it by default.

## Docker

From `server/`:

```bash
HARIS_MAPS_KEY=<your-key> docker compose up --build
```

then open <http://localhost:44101>. You can also put `HARIS_MAPS_KEY=<your-key>` in a `server/.env` file (git-ignored) instead of the command line. The key is read at run time and is never baked into the image.

The image builds the server with Gradle and runs it on a Java 21 runtime. To use PRISM in the container, mount a Linux PRISM 4.8 installation and point HARIS at it with `JAVA_OPTS` (the container's start script does not read `PRISM_HOME`):

```yaml
# docker-compose.override.yml
services:
  haris:
    volumes:
      - /path/to/prism-4.8:/opt/prism
    environment:
      - JAVA_OPTS=-Dprism.home=/opt/prism
```

Study logs are written to the container's working directory, `/app` (see [Logs](#logs)). Copy them out with `docker compose cp haris:/app/. ./out/` or similar before removing the container.

## Using the interface

The **launch page** (`/`) has a tile for each showcased feature, a sandbox tile, and "Browse all scenarios", which lists every scenario file in `server/web/scenarios/`. Tiles with study conditions show a chip for each; pick one, then launch. [Showcase and demo](showcase.md) describes each tile.

A scenario opens with its description. Press **Start Scenario** to start the clock. The operator interface then has two modes:

- **Monitor mode** shows the mission as it runs: agents, tasks, targets found, the lenses the scenario allows, and any panels it enables (scan review, prediction, mission cost).
- **Edit mode** is for planning. Place tasks with the tools on the map, drag from an agent to a task to assign it, or press auto-allocate to let the planner propose an allocation, then confirm it. Depending on the scenario's `allocationStyle`, agents hold position while you edit, keep going, or take new tasks themselves.

The **sandbox** starts with an empty map: add agents and tasks by hand, and try features without writing a scenario.

**Look:** the switch on the launch page, or `?look=classic` / `?look=modern` on any page, picks the interface. Classic is the original interface, with the original 5 Hz engine rate and 400 ms browser refresh. Modern is the refreshed interface at 10 Hz. The choice is remembered in the browser.

**Speed and tick rate:** the sliders under the map lenses change the simulation speed (×0.25 to ×8) and the engine tick rate (2 to 30 Hz) while it runs. Movement, turning, battery, failures and communication timeouts are all scaled per tick, so behaviour per simulated second is the same at any tick rate. A scenario can set its own starting `tickRate`, and each scenario starts at ×1 speed.

**One mission at a time:** the server holds a single mission, shared by every browser that connects. Launching a scenario from one tab replaces whatever another tab was running. Several browsers can watch the same mission.

## Running a user study

A typical session chains a tutorial into the study conditions, with one log per participant.

**Chaining scenarios.** Set `nextScenarioFile` in a scenario to the file that should follow it. When the time limit runs out, the end panel offers a button that loads the next one, so a participant can work through a whole session without the experimenter. See the [scenario reference](scenarios.md#session-flow-and-logging).

**Per-participant logs.** Register the participant before the scenario starts:

```bash
curl -X POST -d 'userName=P017' http://localhost:44101/mode/scenario/registerUser
```

From then on the server writes that participant's actions to `P017-<gameId>.log`.

**Preset links.** A form that posts `file-name=<scenario file>` to `/preset/scenario` loads that scenario and sends the browser straight to the operator interface, skipping the launch page.

### Logs

Logs are written to the server's working directory (`server/` when you use `./gradlew run`, `/app` in Docker):

| File | Contents |
|---|---|
| `Simulator.<n>.<g>.log` | The server log for each run, rotated per start |
| `<userName>-<gameId>.log` | One participant's session in one scenario, after `registerUser` |

Each line is `timestamp; time; CODE; description; values`. The codes are short tags such as `SVRST` (server reset) or `SCORE` (periodic score and mission cost), so logs are easy to filter. All `*.log` files are git-ignored.

## Troubleshooting

| Problem | What to do |
|---|---|
| The map is grey or shows "This page can't load Google Maps correctly" | No key, a wrong key, or the key's referrer restriction doesn't include the address in your browser bar. The server log warns once if no key is configured. |
| `Address already in use` on start | Something else has port 44101. Stop it, or use `./gradlew run --args=<port>`. |
| A launched scenario vanished | Another tab or browser launched a scenario. There is one mission per server. |
| Gradle can't download Java 21 | Behind a proxy, configure Gradle's proxy settings, or install a Java 21 JDK yourself so no download is needed. |
| The live PFM condition shows no estimates | PRISM isn't found. Check `PRISM_HOME` (or `-Dprism.home`) points at a PRISM 4.8 folder that contains `lib/`, and on Linux or macOS that you ran PRISM's `install.sh`. PRISM's own output appears in the server console. |
| `web/...` not found, or a blank page | The server was started from the wrong folder. Start it from `server/`. |
