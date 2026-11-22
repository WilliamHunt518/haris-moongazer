package tool;

import java.io.IOException;
import java.io.PrintWriter;
import java.nio.file.*;
import java.util.*;

/**
 * Summarises a degradation-study log (see {@code server.controller.EpisodeController}) into two CSV files next to it:
 * {@code <log>.episodes.csv}, one row per episode, and {@code <log>.summary.csv}, hits, misses, false presses and mean
 * reaction time per swarm size.
 * <p>
 * The simulator runs this automatically at the end of a study run when logging by participant id. To redo it, from
 * {@code server/}: {@code ./gradlew -q processStudyLogs -Plogs="P01-EpA.log P02-EpA.log"}. With no logs given it
 * processes every {@code *.log} in {@code server/}.
 */
public class LogProcessor {

    private static final class Row {
        String code, degColour = "";
        int index, prev, n;
        double degTime;
        boolean degraded, pressed, hit;
        long reactionMs;
        int falsePresses;
        String workload = "", performance = "";
    }

    public static void main(String[] args) throws IOException {
        List<Path> logs = new ArrayList<>();
        if (args.length > 0) {
            for (String a : args) logs.add(Path.of(a));
        } else {
            try (DirectoryStream<Path> ds = Files.newDirectoryStream(Path.of("."), "*.log")) {
                ds.forEach(logs::add);
            }
        }
        for (Path p : logs) processLogFile(p.toString());
    }

    public static void processLogFile(String logFile) {
        List<String> lines;
        try {
            lines = Files.readAllLines(Path.of(logFile));
        } catch (IOException e) {
            System.err.println("Could not read " + logFile + ": " + e.getMessage());
            return;
        }

        List<Row> rows = new ArrayList<>();
        Row cur = null;
        for (String line : lines) {
            // "<date>; <sim time>; <CODE>; <description>; v1; v2; ..."
            String[] p = line.split(";");
            if (p.length < 3) continue;
            String event = p[2].trim();
            String[] v = p.length > 4 ? Arrays.stream(p, 4, p.length).map(String::trim).toArray(String[]::new) : new String[0];
            try {
                switch (event) {
                    case "NEWEP" -> {
                        cur = new Row();
                        cur.code = v[0];
                        cur.prev = Integer.parseInt(v[1]);
                        cur.n = Integer.parseInt(v[2]);
                        cur.degColour = v[3];
                        cur.degTime = Double.parseDouble(v[4]);
                        cur.index = v.length > 5 ? Integer.parseInt(v[5]) : rows.size() + 1;
                        rows.add(cur);
                    }
                    case "DEGTR" -> { if (cur != null) cur.degraded = true; }
                    case "DGCLK" -> {
                        if (cur == null) break;
                        boolean success = Boolean.parseBoolean(v[3]);
                        boolean first = v.length > 6 && Boolean.parseBoolean(v[6]);
                        if (success) {
                            cur.hit = true;
                            cur.pressed = true;
                            cur.reactionMs = Math.round(Double.parseDouble(v[4]));
                        } else if (!cur.degraded) {
                            cur.falsePresses++;
                        } else if (first) {
                            cur.pressed = true;
                        }
                    }
                    case "WKLD" -> {
                        // Answers come after the episode they rate
                        if (!rows.isEmpty()) rows.get(rows.size() - 1).workload = v[0];
                    }
                    case "PRCP" -> {
                        if (!rows.isEmpty()) rows.get(rows.size() - 1).performance = v[0];
                    }
                    default -> { }
                }
            } catch (RuntimeException ignored) {
                // A line from another version of the log format; skip it
            }
        }

        if (rows.isEmpty()) {
            System.out.println("No episodes in " + logFile);
            return;
        }
        String base = logFile.replaceFirst("\\.log$", "");
        Path episodesCsv = Path.of(base + ".episodes.csv");
        Path summaryCsv = Path.of(base + ".summary.csv");
        try (PrintWriter w = new PrintWriter(Files.newBufferedWriter(episodesCsv))) {
            w.println("Index,EpisodeCode,PrevAgents,NumAgents,DegColour,DegTime,Degraded,Detected,ReactionMs,FalsePresses,Workload,Performance");
            for (Row r : rows)
                w.printf(Locale.US, "%d,%s,%d,%d,%s,%.1f,%s,%s,%s,%d,%s,%s%n", r.index, r.code, r.prev, r.n, r.degColour,
                        r.degTime, r.degraded, r.hit, r.hit ? Long.toString(r.reactionMs) : "", r.falsePresses,
                        r.workload, r.performance);
        } catch (IOException e) {
            System.err.println("Could not write " + episodesCsv + ": " + e.getMessage());
            return;
        }

        Map<Integer, List<Row>> byN = new TreeMap<>();
        rows.forEach(r -> byN.computeIfAbsent(r.n, k -> new ArrayList<>()).add(r));
        try (PrintWriter w = new PrintWriter(Files.newBufferedWriter(summaryCsv))) {
            w.println("NumAgents,Episodes,Hits,Misses,FalsePresses,HitRate,MeanReactionMs,MeanWorkload,MeanPerformance");
            for (Map.Entry<Integer, List<Row>> e : byN.entrySet()) {
                writeSummary(w, Integer.toString(e.getKey()), e.getValue());
            }
            writeSummary(w, "all", rows);
        } catch (IOException e) {
            System.err.println("Could not write " + summaryCsv + ": " + e.getMessage());
            return;
        }
        System.out.println("Wrote " + episodesCsv + " and " + summaryCsv);
    }

    private static void writeSummary(PrintWriter w, String label, List<Row> rs) {
        long degradedCount = rs.stream().filter(r -> r.degraded).count();
        long hits = rs.stream().filter(r -> r.hit).count();
        int falsePresses = rs.stream().mapToInt(r -> r.falsePresses).sum();
        double hitRate = degradedCount > 0 ? (double) hits / degradedCount : 0;
        OptionalDouble rt = rs.stream().filter(r -> r.hit).mapToLong(r -> r.reactionMs).average();
        OptionalDouble wl = rs.stream().filter(r -> !r.workload.isEmpty()).mapToInt(r -> Integer.parseInt(r.workload)).average();
        OptionalDouble pf = rs.stream().filter(r -> !r.performance.isEmpty()).mapToInt(r -> Integer.parseInt(r.performance)).average();
        w.printf(Locale.US, "%s,%d,%d,%d,%d,%.3f,%s,%s,%s%n", label, rs.size(), hits, degradedCount - hits, falsePresses,
                hitRate, rt.isPresent() ? String.format(Locale.US, "%.0f", rt.getAsDouble()) : "",
                wl.isPresent() ? String.format(Locale.US, "%.2f", wl.getAsDouble()) : "",
                pf.isPresent() ? String.format(Locale.US, "%.2f", pf.getAsDouble()) : "");
    }
}
