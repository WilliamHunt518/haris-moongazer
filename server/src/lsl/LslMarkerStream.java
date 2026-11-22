package lsl;

import com.sun.jna.Library;
import com.sun.jna.Native;
import com.sun.jna.Pointer;

import java.util.logging.Logger;

/**
 * Sends string event markers on a Lab Streaming Layer (LSL) outlet, so that recordings such as fNIRS (Oxysoft) can be
 * lined up with what happened in the simulator. Used by the degradation study (scenario key "lslMarkers": true).
 * <p>
 * This binds only the five liblsl functions it needs through JNA. liblsl itself is not shipped: install it for your
 * platform (https://github.com/sccn/liblsl/releases) and either put it on the library path or set HARIS_LSL_LIB to the
 * full path of lsl.dll, liblsl.so or liblsl.dylib. If it can't be loaded the stream is disabled and the run carries on.
 * <p>
 * The stream is named "OxysoftMarkers" with type "Markers" and source id "uniqueID12345", as in the original study
 * branch, so existing lab set-ups keep finding it.
 */
public class LslMarkerStream {
    private static final Logger LOGGER = Logger.getLogger(LslMarkerStream.class.getName());
    private static final int CF_STRING = 3;  // lsl_channel_format_t cft_string

    /** The part of the liblsl C API used here. */
    public interface LslLibrary extends Library {
        Pointer lsl_create_streaminfo(String name, String type, int channelCount, double nominalSrate, int channelFormat, String sourceId);
        Pointer lsl_create_outlet(Pointer info, int chunkSize, int maxBuffered);
        int lsl_push_sample_str(Pointer outlet, String[] data);
        void lsl_destroy_outlet(Pointer outlet);
        void lsl_destroy_streaminfo(Pointer info);
    }

    private LslLibrary lib;
    private Pointer info;
    private Pointer outlet;

    /** Opens the outlet. Check {@link #isOpen()}: on any failure the stream stays closed and markers are dropped. */
    public LslMarkerStream() {
        String libName = System.getenv().getOrDefault("HARIS_LSL_LIB", "lsl");
        try {
            lib = Native.load(libName, LslLibrary.class);
            info = lib.lsl_create_streaminfo("OxysoftMarkers", "Markers", 1, 0.0, CF_STRING, "uniqueID12345");
            outlet = lib.lsl_create_outlet(info, 0, 360);
            LOGGER.info("LSL marker stream 'OxysoftMarkers' open");
        } catch (Throwable t) {
            LOGGER.warning("LSL markers disabled: could not load liblsl (" + libName + "): " + t.getMessage());
            lib = null;
            info = null;
            outlet = null;
        }
    }

    public boolean isOpen() {
        return outlet != null;
    }

    public synchronized void send(String marker) {
        if (outlet == null || marker == null || marker.isEmpty())
            return;
        lib.lsl_push_sample_str(outlet, new String[]{marker});
    }

    public synchronized void close() {
        if (lib == null)
            return;
        if (outlet != null)
            lib.lsl_destroy_outlet(outlet);
        if (info != null)
            lib.lsl_destroy_streaminfo(info);
        outlet = null;
        info = null;
    }
}
