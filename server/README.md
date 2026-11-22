# HARIS server

This folder is the simulator: the Java server (`src/`) and the browser client it serves (`web/`). Run every command from here.

```bash
export HARIS_MAPS_KEY=<your-key>     # or set maps.key in config.properties (copy config.example.properties)
./gradlew run                        # http://localhost:44101
./gradlew run --args=8000            # another port
./gradlew installDist                # standalone copy in build/install/haris-moongazer/
docker compose up --build            # in a container
```

For PRISM (live predictions in predictive fleet management), set `PRISM_HOME` to a PRISM 4.8 folder before `./gradlew run`.

| Path | Contents |
|---|---|
| `src/` | Java sources. Entry point: `server.Simulator` |
| `web/` | Browser client, launch page, theme, scenarios, showcase tiles, replays |
| `web/scenarios/` | Scenario files ([reference](../docs/scenarios.md)) |
| `web/showcase/showcase.json` | Launch page tiles ([how to add one](../docs/showcase.md#adding-or-changing-a-tile)) |
| `build.gradle`, `settings.gradle`, `gradlew` | Gradle build |
| `Dockerfile`, `docker-compose.yml` | Container build |
| `config.example.properties` | Template for the git-ignored `config.properties` |
| `logging.properties`, `loggingForStudy.properties` | Log formats |

Logs are written to this folder: `Simulator.*.log` for each run, and `<participant>-<gameId>.log` for registered participants.

Full documentation: [getting started](../docs/getting-started.md), [architecture](../docs/architecture.md), [REST API](../docs/api.md).
