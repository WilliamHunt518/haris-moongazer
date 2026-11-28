package server.strattac;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

import java.io.IOException;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Map;
import java.util.logging.Logger;

/**
 * Writes the strategic/tactical study's log to disk, in the original study's formats.
 *
 * For each study started, in the log directory (log/strattac by default):
 *   <stamp>_<participant>_<condition>_<seed>.jsonl       every event, one JSON object per line, written as it happens
 *   study_<participant>_<condition>_<seed>_<stamp>.json  the participant file (the original's "Download Data"),
 *                                                        rewritten when each session ends, after its surveys and at the end
 * The stamp keeps a re-run with the same participant id from overwriting an earlier one.
 */
public class StudyLogWriter implements StratTacEngine.StudyLog {

    private static final Gson GSON = new GsonBuilder().serializeNulls().create();
    private static final Gson PRETTY = new GsonBuilder().serializeNulls().setPrettyPrinting().create();
    private static final DateTimeFormatter STAMP = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss");

    private final Path dir;
    private final Logger logger;
    private Writer events;
    private Path eventsFile;
    private Path studyFile;

    public StudyLogWriter(Path dir, Logger logger) {
        this.dir = dir;
        this.logger = logger;
    }

    /** The files of the current study, or null before one starts. */
    public synchronized Path eventsFile() { return eventsFile; }
    public synchronized Path studyFile() { return studyFile; }

    @Override
    public synchronized void studyStarted(StratTacEngine.StudyConfig config) {
        close();
        String name = safe(config.participantId.isEmpty() ? "anon" : config.participantId) + "_" + safe(config.condition) + "_" + config.seed;
        String stamp = LocalDateTime.now().format(STAMP);
        try {
            Files.createDirectories(dir);
            eventsFile = dir.resolve(stamp + "_" + name + ".jsonl");
            studyFile = dir.resolve("study_" + name + "_" + stamp + ".json");
            events = Files.newBufferedWriter(eventsFile, StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
            logger.info("StratTac study log: " + eventsFile.toAbsolutePath());
        } catch (IOException e) {
            logger.warning("StratTac study log could not be opened in " + dir.toAbsolutePath() + ": " + e);
            events = null;
        }
    }

    @Override
    public synchronized void event(Map<String, Object> event) {
        if (events == null) return;
        try {
            events.write(GSON.toJson(event));
            events.write('\n');
            events.flush();
        } catch (IOException e) {
            logger.warning("StratTac study log write failed: " + e);
        }
    }

    @Override
    public synchronized void checkpoint(Map<String, Object> payload, boolean done) {
        if (studyFile == null) return;
        // Write beside the file, then move over it, so a crash mid-write never leaves a broken participant file
        Path tmp = studyFile.resolveSibling(studyFile.getFileName() + ".tmp");
        try {
            Files.writeString(tmp, PRETTY.toJson(payload), StandardCharsets.UTF_8);
            Files.move(tmp, studyFile, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            if (done) logger.info("StratTac participant file: " + studyFile.toAbsolutePath());
        } catch (IOException e) {
            logger.warning("StratTac participant file write failed: " + e);
        }
    }

    public synchronized void close() {
        if (events != null) {
            try { events.close(); } catch (IOException ignored) { }
        }
        events = null;
    }

    private static String safe(String s) {
        String out = s == null ? "" : s.replaceAll("[^A-Za-z0-9._-]", "-");
        return out.isEmpty() ? "x" : out;
    }
}
