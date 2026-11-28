# StratTac engine parity check

Compares the Java StratTac engine (`server/src/server/strattac/`) with the original study's TypeScript code: mission
plans, Strategic Assistant cards, Tactical Assistant plans, and whole sessions played by the same scripted operator.

```bash
tools/strattac-parity/run.sh /path/to/GraphColouringNew      # SEEDS=20 for a longer run
```

The original checkout needs `npm install`. The script copies its TypeScript drivers into the original's `sim/` folder
for the run and removes them afterwards. It reads no participant data.
