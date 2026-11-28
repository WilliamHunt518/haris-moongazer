import server.strattac.*;
import java.util.*;
public class TacDump {
  public static void main(String[] a) {
    Map<String, Double> sp = new HashMap<>(); sp.put("Blue",11.0); sp.put("Red",10.0); sp.put("Green",9.0);
    Params p = new Params(sp, new Model.Comp(11,11,11));
    Map<String,String> P = Map.of("Blue","B","Red","R","Green","G");
    StringBuilder sb = new StringBuilder();
    for (String cx : new String[]{"balanced","strategic","tactical","full"}) for (int seed = 1; seed <= 40; seed++) {
      List<Model.Blueprint> plan = MissionGen.generateSessionPlan(new Rng(seed), cx, 480, new ArrayList<>());
      for (int k = 0; k < plan.size(); k++) {
        Model.Blueprint bp = plan.get(k);
        List<Model.Task> tasks = new ArrayList<>();
        for (int i = 0; i < bp.taskTypes.length; i++) { Model.Task t = new Model.Task(); t.id = bp.id+"-T"+(i+1); t.missionId = bp.id; t.type = bp.taskTypes[i]; t.waypoint = bp.waypoints.get(i); tasks.add(t); }
        int h = seed * 31 + k * 7;
        int[] n = {1 + h % 4, 1 + (h*3) % 4, 1 + (h*5) % 4};
        List<Model.Asset> assets = new ArrayList<>(); List<String> ids = new ArrayList<>();
        String[] tys = {"Blue","Red","Green"};
        for (int ti = 0; ti < 3; ti++) for (int i = 1; i <= n[ti]; i++) { Model.Asset as = new Model.Asset(); as.id = P.get(tys[ti]) + String.format("%02d", i); as.type = tys[ti]; as.position = new Model.Pt(500,400); assets.add(as); ids.add(as.id); }
        List<Model.Task> sorted = new ArrayList<>(tasks); sorted.sort((x, y) -> y.type - x.type);
        List<String> order = new ArrayList<>(); for (Model.Task t : sorted) order.add(t.id);
        for (boolean greedy : new boolean[]{false, true}) {
          Map<String, List<String>> r = Tactical.computeTacticalSuggestion(p, ids, order, tasks, assets, greedy, false);
          StringBuilder s = new StringBuilder();
          for (String t : new TreeSet<>(r.keySet())) { if (s.length()>0) s.append(';'); s.append(t).append('=').append(String.join(",", r.get(t))); }
          sb.append(String.join("|", cx, ""+seed, bp.id, ""+greedy, s)).append('\n');
        }
      }
    }
    System.out.print(sb);
  }
}
