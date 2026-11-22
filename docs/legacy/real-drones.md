# For later: real drones and manual control

HARIS Moongazer only simulates drones. HutSim, which HARIS grew from, could also fly **real DJI drones** through an Android app and let an operator take **manual control** of a drone. That code is still in the repository but isn't built, tested or maintained. This page keeps what is known about it, so the feature can be brought back later.

**Status:** not working as is. The RabbitMQ server, the Bitbucket repositories and the University VPN that the original setup relied on are gone, and the Android app targets a 2018 DJI SDK.

## How it worked

```
DJI drone ⇄ remote controller ⇄ (USB) Android app ⇄ (REST, then RabbitMQ) HARIS server ⇄ browser
```

- The **Android app** (`controller/`) connected to the drone's remote controller over USB, using the [DJI Mobile SDK](https://developer.dji.com/mobile-sdk/). It showed the drone's position on a map and its camera feed.
- On start-up the app **registered with the server** over REST (`POST /register` with `lat`, `lon`). The server then opened a RabbitMQ channel for that drone and told the app its name. From then on, position updates and mission commands went over RabbitMQ rather than REST.
- On the server, a registered drone is an **`AgentReal`**, handled by **`QueueManager`** (`server/src/server/QueueManager.java`). Planning and allocation treated real and virtual agents the same; only movement differed, since a real agent reports its position instead of being simulated. Some features, such as deleting an agent, were disabled for real agents.
- In **autonomous mode** the drone carried out the missions the server sent. The pilot could switch the app to **manual mode** at any time, after which commands from the server were ignored and the pilot flew with the remote controller.
- For testing without flying, the drone could run in the **DJI PC Simulator** on a Windows PC, connected over USB, with both autonomous and remote-controller flight happening in the simulator.

## Manual control from the browser

Separately from the Android app, the server has endpoints and pages for driving one agent directly. The Moongazer interface doesn't use them.

| Endpoint | Params | Purpose |
|---|---|---|
| `POST /teleop` | `linear`, `angular`, `id` | Drive an agent with linear and angular velocity. |
| `POST /ardrone_pos` | `id`, `x`, `y`, `a` | Set the position of a Parrot AR.Drone from an external tracker. |
| `POST /agents/<id>` | `[speed]`, `[altitude]` | Change an agent's speed or altitude. |

Agents carry a `manuallyControlled` flag in the state. The browser side is in `server/web/controller.html`, `camera.html`, `app/views/control.js`, `app/devices/ardrone.js` and `lib/joystick/`, with an optional ROS bridge (`?rosbridge=` and `lib/ros/`).

## Android app set-up, as it was

Full original instructions are in [`controller/README.md`](../../controller/README.md). In short:

1. Build the app in Android Studio and install it on an Android device.
2. Point it at the server: set `serverAddress` in `controller/app/src/main/java/com/dji/hut_controller/handler/ServerHandler.java` (originally `http://server-ip:8000/`; Moongazer now listens on 44101).
3. Supply your own DJI SDK and Google Maps Android keys in `controller/app/src/main/AndroidManifest.xml`. Don't commit them.
4. Start the server, connect the device to the remote controller by USB, power on the controller and drone, and press "Connect to Server" in the app.

App structure: `DJIHutApplication` holds the handlers; `DroneHandler` manages the DJI SDK connection; `MissionHandler` turns server missions into drone commands; `ServerHandler` talks to the server. There are two screens, a connection screen and an overview with the map and camera feed.

## Bringing it back

Rough order of work, if this is picked up:

1. Replace the hosted RabbitMQ with a local broker (for example in `docker-compose.yml`), or replace the queue with WebSockets on the existing HTTP server.
2. Port the Android app to a current DJI SDK and Gradle, and make the server address configurable in the app.
3. Re-test `AgentReal` against the current main loop (tick-rate scaling, timing sliders, logging).
4. Add a scenario option for real agents, so simulated studies are unaffected.
