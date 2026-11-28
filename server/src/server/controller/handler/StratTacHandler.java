package server.controller.handler;

import server.Simulator;
import server.strattac.StratTacEngine;
import tool.GsonUtils;
import tool.HttpServer.Request;
import tool.HttpServer.Response;

import java.io.IOException;
import java.util.Map;

/**
 * REST API for the strategic/tactical study:
 *   GET  /strattac/config  the scenario's strattac and interface blocks
 *   GET  /strattac/state   a snapshot of the engine state (polled by every view)
 *   POST /strattac/action  one operator action, as a JSON object with a "type" field
 */
public class StratTacHandler extends RestHandler {

    public StratTacHandler(String handlerName, Simulator simulator) {
        super(handlerName, simulator);
    }

    @Override
    public void handleGet(Request req, Response resp) throws IOException, UnregisteredPathException {
        String rPath = parseRemainingPath(req.getPath());
        if (rPath == null) rPath = "";
        switch (rPath) {
            case "/config":
                sendJson(resp, simulator.getStratTacController().configJson());
                break;
            case "/state": {
                StratTacEngine engine = simulator.getStratTacController().getEngine();
                if (engine == null) resp.send(404, "No strategic/tactical study is loaded");
                else sendJson(resp, engine.snapshotJson());
                break;
            }
            default:
                throw new UnregisteredPathException("No method for handling GET request on " + req.getPath());
        }
    }

    @Override
    public void handlePost(Request req, Response resp) throws IOException, UnregisteredPathException {
        String rPath = parseRemainingPath(req.getPath());
        if (!"/action".equals(rPath))
            throw new UnregisteredPathException("No method for handling POST request on " + req.getPath());
        StratTacEngine engine = simulator.getStratTacController().getEngine();
        if (engine == null) {
            resp.send(404, "No strategic/tactical study is loaded");
            return;
        }
        Object body;
        try {
            body = GsonUtils.fromJson(req.getBodyContent());
        } catch (RuntimeException e) {
            resp.send(400, "Expected a JSON object");
            return;
        }
        if (!(body instanceof Map<?, ?> action) || !(action.get("type") instanceof String)) {
            resp.send(400, "Expected a JSON object with a \"type\" field");
            return;
        }
        @SuppressWarnings("unchecked")
        String result = engine.dispatch((Map<String, Object>) action);
        sendJson(resp, result);
    }

    private static void sendJson(Response resp, String json) throws IOException {
        resp.getHeaders().add("Content-type", "application/json; charset=utf-8");
        resp.send(200, json);
    }
}
