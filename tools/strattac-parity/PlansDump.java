import server.strattac.*;
import java.util.*;
public class PlansDump {
  public static void main(String[] a) {
    StringBuilder sb = new StringBuilder();
    for (String cx : new String[]{"balanced","strategic","tactical","full","quick"}) for (int seed = 1; seed <= 60; seed++) for (int idx : new int[]{1,2}) {
      for (Model.Blueprint b : MissionGen.generateSessionPlan(new Rng(seed ^ idx), cx, 480, new ArrayList<>())) {
        StringBuilder w = new StringBuilder();
        for (Model.Pt p : b.waypoints) { if (w.length()>0) w.append(';'); w.append(p.x).append(',').append(p.y); }
        StringBuilder t = new StringBuilder(); for (int x : b.taskTypes) t.append(x);
        sb.append(String.join("|", cx, ""+seed, ""+idx, b.id, ""+b.arrivalTime, b.category, t, ""+b.zoneCenter.x, ""+b.zoneCenter.y, w)).append('\n');
      }
    }
    System.out.print(sb);
  }
}
