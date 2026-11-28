package server.controller;

import server.Simulator;
import server.strattac.StratTacEngine;
import server.strattac.StudyLogWriter;
import tool.GsonUtils;

import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.logging.FileHandler;

/**
 * Hosts the strategic/tactical drone study (StratTac) inside HARIS.
 *
 * A scenario turns it on with a "strattac" block; its "interface" block is handed to the browser, where the interface
 * configurator (web/studio) builds the strategic and tactical views from it. The engine runs on the server and is
 * advanced by the simulator's main loop, so every browser tab sees one authoritative state.
 */
public class StratTacController extends AbstractController {

    private volatile StratTacEngine engine;
    private volatile Map<String, Object> scenario;
    private StudyLogWriter studyLog;

    public StratTacController(Simulator simulator) {
        super(simulator, StratTacController.class.getName());
    }

    public void configure(Map<String, Object> scenario) {
        this.scenario = scenario;
        this.engine = new StratTacEngine(scenario, LOGGER);
        closeLog();
        Object st = scenario.get("strattac");
        Object dir = st instanceof Map<?, ?> m ? m.get("logDir") : null;
        // "logDir": false turns the files off; a string picks another directory
        if (!Boolean.FALSE.equals(dir)) {
            studyLog = new StudyLogWriter(Path.of(dir instanceof String d && !d.isBlank() ? d : "log/strattac"), LOGGER);
            engine.setStudyLog(studyLog);
        }
        LOGGER.info(String.format("%s; STCFG; StratTac study configured", simulator.getState().getTime()));
    }

    public boolean isEnabled() {
        return engine != null;
    }

    public void step(double dt) {
        StratTacEngine e = engine;
        if (e != null) e.step(dt);
    }

    public void reset() {
        closeLog();
        engine = null;
        scenario = null;
    }

    @Override
    public void resetLogger(FileHandler fileHandler) {
        super.resetLogger(fileHandler);
    }

    /** What the browser needs to build its views: the scenario's strattac and interface blocks. */
    public String configJson() {
        Map<String, Object> s = scenario;
        Map<String, Object> out = new LinkedHashMap<>();
        if (s != null) {
            out.put("gameId", s.get("gameId"));
            out.put("strattac", s.get("strattac"));
            out.put("interface", s.get("interface"));
            out.put("rules", server.strattac.Params.rules());
        }
        out.put("enabled", s != null);
        return GsonUtils.toJson(out);
    }

    private void closeLog() {
        if (studyLog != null) studyLog.close();
        studyLog = null;
    }

    public StratTacEngine getEngine() {
        return engine;
    }
}
