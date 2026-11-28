import server.strattac.*;
import com.google.gson.*;
import java.util.*;
import java.util.logging.Logger;
@SuppressWarnings("unchecked")
public class RunJ {
  static Gson g = new Gson();
  static Map<String,Object> J(String s) { return g.fromJson(s, Map.class); }
  static Map<String,Object> M(Object... kv) { Map<String,Object> m = new LinkedHashMap<>(); for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i+1]); return m; }
  static int pen(String c) { return "ABCDE".indexOf(c) + 1; }
  public static void main(String[] a) {
    Logger log = Logger.getLogger("x"); log.setLevel(java.util.logging.Level.OFF);
    String[] cxs = (a.length > 0 ? a[0] : "balanced,strategic,tactical,full").split(",");
    int ns = a.length > 1 ? Integer.parseInt(a[1]) : 20;
    List<Object> types = List.of(M("id","Blue","speed",11,"count",11), M("id","Red","speed",10,"count",11), M("id","Green","speed",9,"count",11));
    StringBuilder out = new StringBuilder();
    for (String cx : cxs) for (int seed = 1; seed <= ns; seed++) {
      StratTacEngine e = new StratTacEngine(M("strattac", M("droneTypes", types)), log);
      e.dispatch(M("type","START_STUDY","config", M("participantId","SIM","mode","agent","complexity",cx,"seed",seed,"numSessions",1,
          "tacticalMode","plan-all","fixLockouts",true,"collectDemographics",false)));
      Map<String, Double> recSince = new HashMap<>();
      Map<String,Object> s = J(e.snapshotJson());
      for (int i = 0; i < 480 / 0.1 + 20 && "playing".equals(e.phase()); i++) {
        e.step(0.1);
        if (!"playing".equals(e.phase())) break;
        s = J(e.snapshotJson());
        double el = ((Number) s.get("elapsed")).doubleValue();
        if (Boolean.TRUE.equals(s.get("trustProbeActive"))) e.dispatch(M("type","DISMISS_TRUST_PROBE"));
        for (Object mo : (List<Object>) s.get("missions")) {
          Map<String,Object> m = (Map<String,Object>) mo; String id = (String) m.get("id");
          if (!Boolean.TRUE.equals(m.get("failureRecoveryPending"))) { recSince.remove(id); continue; }
          recSince.putIfAbsent(id, el);
          if (el - recSince.get(id) > 30) { e.dispatch(M("type","ABANDON_MISSION","missionId",id)); continue; }
          Set<String> deployed = new HashSet<>();
          for (Object ao : (List<Object>) s.get("assets")) { Map<String,Object> as = (Map<String,Object>) ao; if (id.equals(as.get("currentMissionId")) && "deployed".equals(as.get("status"))) deployed.add((String) as.get("id")); }
          Map<String,Object> cur = new LinkedHashMap<>();
          for (Object to : (List<Object>) m.get("tasks")) { Map<String,Object> t = (Map<String,Object>) to; String st = (String) t.get("status");
            if ("pending".equals(st) || "traveling".equals(st)) { List<String> l = new ArrayList<>(); for (Object x : (List<Object>) t.get("assignedAssetIds")) if (deployed.contains(x)) l.add((String) x); cur.put((String) t.get("id"), l); } }
          Map<String,Object> r = J(e.dispatch(M("type","TACTICAL_SUGGEST","missionId",id,"recoveryMode",true,"currentAssignments",cur)));
          Map<String,Object> fin = new LinkedHashMap<>(cur);
          if (r.get("taskAssignments") instanceof Map<?,?> sg) fin.putAll((Map<String,Object>) sg);
          e.dispatch(M("type","CONFIRM_FAILURE_RECOVERY","missionId",id,"taskAssignments",fin,"wasAgentSuggested",true));
        }
        s = J(e.snapshotJson());
        List<Map<String,Object>> queued = new ArrayList<>();
        for (Object mo : (List<Object>) s.get("missions")) { Map<String,Object> m = (Map<String,Object>) mo; if ("queued".equals(m.get("status"))) queued.add(m); }
        queued.sort((x, y) -> pen((String) y.get("category")) - pen((String) x.get("category")));
        for (Map<String,Object> m : queued) {
          s = J(e.snapshotJson());
          Map<String,Integer> res = new HashMap<>(Map.of("Blue",0,"Red",0,"Green",0));
          for (Object ao : (List<Object>) s.get("assets")) { Map<String,Object> as = (Map<String,Object>) ao; if ("available".equals(as.get("status"))) res.merge((String) as.get("type"), 1, Integer::sum); }
          Map<String,Integer> fl = new HashMap<>(Map.of("Blue",0,"Red",0,"Green",0));
          for (Object to : (List<Object>) m.get("tasks")) { int ty = ((Number) ((Map<String,Object>) to).get("type")).intValue(); Model.Comp c = Params.TASK_PRIMARY[ty];
            fl.merge("Blue", c.Blue, Math::max); fl.merge("Red", c.Red, Math::max); fl.merge("Green", c.Green, Math::max); }
          if (res.get("Blue") < fl.get("Blue") || res.get("Red") < fl.get("Red") || res.get("Green") < fl.get("Green")) continue;
          String id = (String) m.get("id");
          e.dispatch(M("type","OPEN_STRATEGIC","missionId",id));
          s = J(e.snapshotJson());
          Map<String,Object> modal = (Map<String,Object>) s.get("strategicModal");
          if (modal == null || !id.equals(modal.get("missionId"))) continue;
          List<Object> sts = (List<Object>) modal.get("strategies"); int use = -1;
          for (int k = 0; k < sts.size(); k++) if ("Aggressive".equals(((Map<String,Object>) sts.get(k)).get("name"))) { use = k; break; }
          if (use < 0) use = sts.isEmpty() ? -1 : 0;
          if (use < 0) { e.dispatch(M("type","CLOSE_STRATEGIC")); continue; }
          e.dispatch(M("type","APPLY_STRATEGIC","missionId",id,"source","agent","strategyIndex",use));
          s = J(e.snapshotJson());
          for (Object mo : (List<Object>) s.get("missions")) { Map<String,Object> mm = (Map<String,Object>) mo; if (id.equals(mm.get("id")) && Boolean.TRUE.equals(mm.get("tacticalPending"))) e.dispatch(M("type","CONFIRM_TACTICAL","missionId",id)); }
        }
      }
      s = J(e.snapshotJson());
      List<Object> evs = new ArrayList<>(); for (Object l : (List<Object>) J("{\"e\":" + e.eventsJson() + "}").get("e")) evs.addAll((List<Object>) l);
      Map<String,Integer> cnt = new HashMap<>(); for (Object o : evs) cnt.merge((String) ((Map<String,Object>) o).get("type"), 1, Integer::sum);
      int nm = 0, done = 0; for (Object mo : (List<Object>) s.get("missions")) { Map<String,Object> m = (Map<String,Object>) mo; if (!((String) m.get("id")).endsWith("-R")) nm++; if ("completed".equals(m.get("status"))) done++; }
      out.append(String.join("|", cx, ""+seed, String.format("%.3f", ((Number) s.get("score")).doubleValue()), String.format("%.3f", ((Number) s.get("penaltyAccrued")).doubleValue()),
        ""+nm, ""+done, ""+cnt.getOrDefault("task_completed",0), ""+cnt.getOrDefault("task_failed",0), ""+cnt.getOrDefault("drone_failure",0),
        ""+cnt.getOrDefault("mission_abandoned",0), ""+cnt.getOrDefault("lockout_detected",0), ""+evs.size())).append('\n');
    }
    System.out.print(out);
  }
}
