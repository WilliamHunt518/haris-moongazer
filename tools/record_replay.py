#!/usr/bin/env python3
"""
Record a scenario run for the static demo (GitHub Pages).

Drives a running HARIS Moongazer server (./gradlew run, port 44101): loads a scenario, starts it, optionally runs
auto-allocation, and samples /state.json at a fixed rate of simulated time. Writes a gzipped JSON file that
server/web/app/replay.js plays back in the real interface.

Format: {"version":1, "id", "file", "title", "hz", "duration", "frames":[{"t": sim_seconds, "d": {changed keys}}]}
The first frame holds the full state; later frames hold only the top-level keys that changed.

Usage: python3 tools/record_replay.py --file PFM_SFV.json --id pfm-live --seconds 150 --out server/web/replays
       [--operator targets] [--allocate-every 15] [--hz 4]

--operator targets: a scripted operator adds a waypoint task on every target (or a ring of waypoints around the map
centre when the scenario has no targets) two seconds in, then runs auto-allocation and confirms it, and repeats the
allocation every --allocate-every seconds. PFM missions allocate themselves and need no operator.
"""
import argparse, gzip, json, math, os, time, urllib.parse, urllib.request

BASE = "http://localhost:44101"
# Keys that the client never needs, or that change every frame without being drawn
DROP = {"prov_doc", "userName", "loggingById", "nextFileName"}
# Large keys that change often but only feed slow overlays: keep at most one update per this many sim seconds
THROTTLE = {"hazardHits": 15.0}


def post(path, data=None):
    body = urllib.parse.urlencode(data or {}).encode()
    req = urllib.request.Request(BASE + path, data=body, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def state():
    with urllib.request.urlopen(BASE + "/state.json", timeout=30) as r:
        return json.loads(r.read())


def operator_tasks(s):
    """Waypoint tasks for the scripted operator: one per target, else a ring around the map centre."""
    pts = [(t["coordinate"]["latitude"], t["coordinate"]["longitude"]) for t in s.get("targets") or []]
    if not pts:
        c = s.get("gameCentre") or (s.get("hub") or {}).get("coordinate") or {}
        lat, lng = c.get("latitude"), c.get("longitude")
        if lat is None:
            return []
        r = 300.0
        for i in range(8):
            a = 2 * math.pi * i / 8
            pts.append((lat + r * math.cos(a) / 111320.0, lng + r * math.sin(a) / (111320.0 * math.cos(math.radians(lat)))))
    return pts


def allocate():
    post("/allocation/auto-allocate")
    post("/allocation/confirm")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True, help="scenario file in server/web/scenarios")
    ap.add_argument("--id", required=True, help="replay id (file name without extension)")
    ap.add_argument("--title", default=None)
    ap.add_argument("--seconds", type=float, default=120, help="simulated seconds to record")
    ap.add_argument("--hz", type=float, default=4, help="frames per simulated second")
    ap.add_argument("--speed", type=float, default=1, help="simulation speed while recording")
    ap.add_argument("--operator", choices=["none", "targets"], default="none")
    ap.add_argument("--allocate-every", type=float, default=15)
    ap.add_argument("--out", default="server/web/replays")
    a = ap.parse_args()

    post("/reset")
    post("/mode/scenario", {"file-name": a.file})
    # Record faster than real time where nothing depends on wall-clock time (PFM's PRISM calls do, so use 1 there)
    post("/mode/timing", {"speed": a.speed, "tickRate": 10})
    post("/mode/scenario/registerUser", {"userName": "replay"})
    first = {k: v for k, v in state().items() if k not in DROP}  # before start: shows the briefing panel
    post("/mode/scenario/start")

    next_alloc = 2.0 if a.operator == "targets" else float("inf")
    placed = False
    last_sent = {}
    frames = [{"t": 0, "d": first}]
    prev = {k: json.dumps(v, sort_keys=True) for k, v in first.items()}
    step, next_t = 1.0 / a.hz, 0.0
    while True:
        s = state()
        t = s.get("time", 0)
        if t + 1 < frames[-1]["t"]:
            break  # the scenario hit its own time limit and the server reset it
        if t >= next_alloc:
            if not placed:
                for lat, lng in operator_tasks(s):
                    try:
                        post("/tasks", {"type": 0, "lat": lat, "lng": lng})
                    except Exception as e:
                        print("task not added:", e)
                placed = True
            allocate()
            next_alloc = t + a.allocate_every
        if t >= next_t or not s.get("inProgress", True):
            s = {k: v for k, v in s.items() if k not in DROP}
            enc = {k: json.dumps(v, sort_keys=True) for k, v in s.items()}
            d = {}
            for k in s:
                if prev.get(k) == enc[k]:
                    continue
                if k in THROTTLE and t - last_sent.get(k, -1e9) < THROTTLE[k]:
                    continue  # leave prev as it was so the change goes out later
                d[k] = s[k]
                prev[k] = enc[k]
                last_sent[k] = t
            frames.append({"t": round(t, 2), "d": d})
            next_t = t + step
            if t >= a.seconds or not s.get("inProgress", True):
                break
        time.sleep(0.02)

    # End of the recording: the interface shows its normal end-of-scenario panel
    frames.append({"t": frames[-1]["t"] + step, "d": {"inProgress": False}})
    out = {"version": 1, "id": a.id, "file": a.file, "title": a.title or first.get("gameId", a.id),
           "hz": a.hz, "duration": frames[-1]["t"], "frames": frames}
    os.makedirs(a.out, exist_ok=True)
    path = os.path.join(a.out, a.id + ".json.gz")
    with gzip.open(path, "wt", encoding="utf-8", compresslevel=9) as f:
        json.dump(out, f, separators=(",", ":"))
    post("/reset")
    post("/mode/timing", {"speed": 1})
    print(f"{path}: {len(frames)} frames, {frames[-1]['t']:.0f} s, {os.path.getsize(path) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
