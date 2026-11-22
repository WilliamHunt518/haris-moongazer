package server.controller;

import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.logging.Logger;

/**
 * Records the screen with ffmpeg for a whole episode run and cuts one clip per episode, named
 * {@code Video[i-total]-<episodeCode>.mp4}. Ported from the degradation study branch (FFmpegScreenRecorder), where it
 * was used to make the stimulus videos.
 * <p>
 * Off unless the scenario sets "recordEpisodes": true and HARIS_FFMPEG points at an ffmpeg executable. The capture
 * input defaults by platform and can be changed with HARIS_FFMPEG_FORMAT and HARIS_FFMPEG_DEVICE:
 * Windows {@code dshow} / {@code video=OBS Virtual Camera} (as in the study), macOS {@code avfoundation} / {@code 1},
 * Linux {@code x11grab} / {@code $DISPLAY}. Clips are written to {@code log/recordings/<gameId>/}.
 */
public class EpisodeRecorder {
    private static final Logger LOGGER = Logger.getLogger(EpisodeRecorder.class.getName());
    private static final double START_LEAD_S = 0.050;   // include a touch before the episode starts
    private static final long SAFETY_LAG_MS = 5000;     // let the encoder flush frames before cutting

    private final String ffmpegExe;
    private final Path outDir;
    private final ExecutorService cutPool = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "ffmpeg-cuts");
        t.setDaemon(true);
        return t;
    });

    private Process proc;
    private OutputStream procStdin;
    private long sessionWallStartMs;
    private Path sessionFile;

    private EpisodeRecorder(String ffmpegExe, Path outDir) {
        this.ffmpegExe = ffmpegExe;
        this.outDir = outDir;
    }

    /** @return a recorder, or null when HARIS_FFMPEG is not set. */
    public static EpisodeRecorder fromEnvironment(String gameId) {
        String exe = System.getenv("HARIS_FFMPEG");
        if (exe == null || exe.isBlank()) {
            LOGGER.warning("recordEpisodes is on but HARIS_FFMPEG is not set; episodes will not be recorded");
            return null;
        }
        String safe = (gameId == null || gameId.isBlank()) ? "unnamed" : gameId.replaceAll("[^A-Za-z0-9._-]", "_");
        return new EpisodeRecorder(exe, Path.of("log", "recordings", safe));
    }

    private static List<String> inputArgs() {
        String os = System.getProperty("os.name", "").toLowerCase(Locale.ROOT);
        String format, device;
        if (os.contains("win")) {
            format = "dshow";
            device = "video=OBS Virtual Camera";
        } else if (os.contains("mac")) {
            format = "avfoundation";
            device = "1";
        } else {
            format = "x11grab";
            device = System.getenv().getOrDefault("DISPLAY", ":0.0");
        }
        format = System.getenv().getOrDefault("HARIS_FFMPEG_FORMAT", format);
        device = System.getenv().getOrDefault("HARIS_FFMPEG_DEVICE", device);
        return List.of("-f", format, "-thread_queue_size", "512", "-use_wallclock_as_timestamps", "1", "-i", device);
    }

    public synchronized void startSession() {
        if (proc != null)
            return;
        try {
            Files.createDirectories(outDir);
            String stamp = new SimpleDateFormat("yyyyMMdd_HHmmss").format(new Date());
            sessionFile = outDir.resolve("session_" + stamp + ".mkv");  // MKV survives a crash
            List<String> args = new ArrayList<>(List.of(ffmpegExe, "-hide_banner", "-y"));
            args.addAll(inputArgs());
            args.addAll(List.of("-fflags", "+genpts", "-vsync", "cfr", "-r", "60", "-c:v", "libx264",
                    "-preset", "ultrafast", "-tune", "zerolatency", "-crf", "23", "-pix_fmt", "yuv420p",
                    sessionFile.toString()));
            ProcessBuilder pb = new ProcessBuilder(args);
            pb.redirectErrorStream(true);
            pb.redirectOutput(outDir.resolve("ffmpeg-session.log").toFile());
            sessionWallStartMs = System.currentTimeMillis();
            proc = pb.start();
            procStdin = proc.getOutputStream();
            LOGGER.info("Episode recording started: " + sessionFile);
        } catch (IOException e) {
            LOGGER.warning("Could not start ffmpeg; episodes will not be recorded: " + e.getMessage());
            proc = null;
        }
    }

    /** Queues a clip cut from wall-clock start to end (milliseconds) on a background thread. */
    public void cutEpisodeAsync(String code, int index, int total, long startMs, long endMs) {
        if (sessionFile == null)
            return;
        cutPool.submit(() -> {
            try {
                cutEpisode(code, index, total, startMs, endMs);
            } catch (Exception e) {
                LOGGER.warning("Clip cut failed for " + code + ": " + e);
            }
        });
    }

    private void cutEpisode(String code, int index, int total, long startMs, long endMs) throws IOException, InterruptedException {
        double startSec = Math.max(0.0, (startMs - sessionWallStartMs) / 1000.0 - START_LEAD_S);
        double endSec = Math.max(startSec, (endMs - sessionWallStartMs) / 1000.0);
        long waitUntil = sessionWallStartMs + (long) (endSec * 1000) + SAFETY_LAG_MS;
        long now = System.currentTimeMillis();
        if (now < waitUntil)
            Thread.sleep(waitUntil - now);

        int width = Math.max(3, Integer.toString(Math.max(total, 1)).length());
        String name = String.format(Locale.US, "Video[%0" + width + "d-%0" + width + "d]-%s.mp4",
                index, total, code.replaceAll("[^A-Za-z0-9._-]", "_"));
        File cutLog = outDir.resolve("ffmpeg-cut.log").toFile();
        ProcessBuilder pb = new ProcessBuilder(ffmpegExe, "-hide_banner", "-y", "-i", sessionFile.toString(),
                "-ss", String.format(Locale.US, "%.3f", startSec), "-t", String.format(Locale.US, "%.3f", endSec - startSec),
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-vsync", "cfr",
                "-reset_timestamps", "1", "-movflags", "+faststart", outDir.resolve(name).toString());
        pb.redirectErrorStream(true);
        pb.redirectOutput(ProcessBuilder.Redirect.appendTo(cutLog));
        int rc = pb.start().waitFor();
        if (rc != 0)
            LOGGER.warning("ffmpeg cut of " + name + " failed (exit " + rc + "); see " + cutLog);
    }

    /** Stops the capture cleanly (sends 'q' so the file is closed properly). Queued cuts still finish. */
    public synchronized void stop() {
        if (proc == null)
            return;
        try {
            try {
                procStdin.write('q');
                procStdin.flush();
            } catch (IOException ignored) {
            }
            if (!proc.waitFor(4, TimeUnit.SECONDS)) {
                proc.destroy();
                if (!proc.waitFor(2, TimeUnit.SECONDS))
                    proc.destroyForcibly();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            proc.destroyForcibly();
        } finally {
            proc = null;
            procStdin = null;
            cutPool.shutdown();
            LOGGER.info("Episode recording stopped");
        }
    }
}
