package tool;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Properties;
import java.util.logging.Logger;

/**
 * Supplies the Google Maps JavaScript API key at run time, so that no key is stored in the repository.
 *
 * The key is looked up, in order, from:
 *   1. the environment variable HARIS_MAPS_KEY
 *   2. the Java system property haris.maps.key (-Dharis.maps.key=...)
 *   3. maps.key in config.properties in the working directory (git-ignored; see config.example.properties)
 *
 * HTML pages refer to the key as the placeholder %HARIS_MAPS_KEY%, which is substituted when the page is served.
 * The key itself is never logged.
 */
public final class MapsKey {
    public static final String PLACEHOLDER = "%HARIS_MAPS_KEY%";
    public static final String ENV_VAR = "HARIS_MAPS_KEY";
    public static final String SYS_PROP = "haris.maps.key";
    public static final String CONFIG_FILE = "config.properties";

    private static final Logger LOGGER = Logger.getLogger(MapsKey.class.getName());
    private static volatile String cached;

    private MapsKey() {}

    public static String get() {
        String k = cached;
        if (k != null) return k;
        k = lookup();
        if (k.isEmpty())
            LOGGER.warning("No Google Maps key configured. Set " + ENV_VAR + " (or " + SYS_PROP
                    + ", or maps.key in " + CONFIG_FILE + "). Maps will not load.");
        cached = k;
        return k;
    }

    private static String lookup() {
        String k = System.getenv(ENV_VAR);
        if (k != null && !k.trim().isEmpty()) return k.trim();
        k = System.getProperty(SYS_PROP);
        if (k != null && !k.trim().isEmpty()) return k.trim();
        File f = new File(CONFIG_FILE);
        if (f.isFile()) {
            Properties p = new Properties();
            try (InputStream in = new FileInputStream(f)) {
                p.load(in);
                k = p.getProperty("maps.key");
                if (k != null && !k.trim().isEmpty()) return k.trim();
            } catch (IOException e) {
                LOGGER.warning("Could not read " + CONFIG_FILE + ": " + e.getMessage());
            }
        }
        return "";
    }

    /** True if this request should be served through {@link #serveHtml}. */
    public static boolean isHtml(File file) {
        return file.isFile() && file.getName().toLowerCase().endsWith(".html");
    }

    /** Serves an HTML file with the key placeholder substituted. */
    public static void serveHtml(File file, HttpServer.Response resp) throws IOException {
        String html = new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
        if (html.contains(PLACEHOLDER))
            html = html.replace(PLACEHOLDER, urlEncode(get()));
        resp.send(200, html);
    }

    private static String urlEncode(String s) {
        try {
            return java.net.URLEncoder.encode(s, "UTF-8");
        } catch (java.io.UnsupportedEncodingException e) {
            return s;
        }
    }
}
