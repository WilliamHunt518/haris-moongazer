# Legacy documentation

These are the documents that came with HutSim (the "DJI Hut" server and Android controller, University of Southampton, 2018) and the early HARIS years (2021–2022). They are kept for history and for the parts of the design that have not changed, such as the allocation process and the task types.

**Much of this is out of date.** In particular, the setup steps (IntelliJ, port 8000, `hut.jar`, RabbitMQ, the University VPN), the start menu and the scenario field list no longer match the code. For anything current, use the [main documentation](../README.md).

| File | What it was | Current replacement |
|---|---|---|
| [server-README.md](server-README.md) | The server README (2021), including the first drone programmer guide | [Getting started](../getting-started.md), [Architecture](../architecture.md) |
| [documentation.md](documentation.md) | HutSim server documentation (2018) | [Architecture](../architecture.md) |
| [userDocumentation.md](userDocumentation.md) | Short run guide (2022) | [Getting started](../getting-started.md) |
| [feature_guide.md](feature_guide.md) | HutSim feature tour: modes, agents, task types, allocation, overlays (2018) | [Architecture](../architecture.md), [Showcase](../showcase.md) |
| [scenario_files.md](scenario_files.md) | Scenario file fields (2022) | [Scenario reference](../scenarios.md) |
| [endpoints.md](endpoints.md) | REST API (2018) | [REST API](../api.md) |
| [file_tree.md](file_tree.md) | Annotated source tree (2022) | [Architecture](../architecture.md) |
| [ProgrammerHandler.html](ProgrammerHandler.html) | Javadoc for the drone programmer library | `server/src/server/model/agents/ProgrammerHandler.java` |

Links to the HutSim Bitbucket repositories in these files may no longer work. The Android controller has its own (also legacy) documentation in [`controller/`](../../controller/README.md).
