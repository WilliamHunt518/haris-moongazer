import server.strattac.*;
import java.util.*;
public class StratDump {
  public static void main(String[] a) {
    String[] cols = {"Blue","Red","Green"};
    Map<String, Double> sp = new HashMap<>(); sp.put("Blue",11.0); sp.put("Red",10.0); sp.put("Green",9.0);
    Params p = new Params(sp, new Model.Comp(11,11,11));
    StringBuilder sb = new StringBuilder();
    for (String cx : new String[]{"balanced","strategic","tactical","full"}) for (int seed = 1; seed <= 40; seed++) {
      List<Model.Blueprint> plan = MissionGen.generateSessionPlan(new Rng(seed), cx, 480, new ArrayList<>());
      for (int k = 0; k < plan.size(); k++) {
        Model.Blueprint bp = plan.get(k);
        List<Model.Task> tasks = new ArrayList<>();
        for (int i = 0; i < bp.taskTypes.length; i++) { Model.Task t = new Model.Task(); t.id = bp.id+"-T"+(i+1); t.missionId = bp.id; t.type = bp.taskTypes[i]; t.waypoint = bp.waypoints.get(i); tasks.add(t); }
        int h = seed * 31 + k * 7;
        Model.Comp res = new Model.Comp(h % 12, (h*3) % 12, (h*5) % 12);
        boolean fires = h % 3 == 0;
        for (Model.Strategy c : Copilot.generateStrategies(p, tasks, res, fires, cols[h % 3]))
          sb.append(String.join("|", cx, ""+seed, bp.id, c.name, ""+c.assets.Blue, ""+c.assets.Red, ""+c.assets.Green, js(c.expectedCompletionTime), js(c.speedScore), js(c.reserveScore), js(c.redundancyScore), ""+c.isBadSuggestion, c.badSuggestionColour==null?"":c.badSuggestionColour)).append('\n');
      }
    }
    System.out.print(sb);
  }
  static String js(double d) { return Double.isInfinite(d) ? "Infinity" : ""+d; }
}
