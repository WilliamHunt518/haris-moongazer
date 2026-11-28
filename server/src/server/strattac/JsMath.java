package server.strattac;

/** Maths that must round exactly as the browser did, so seeded results match the original study. */
public final class JsMath {
    private JsMath() {}

    /** V8's Math.hypot (scaled, Kahan-compensated), which differs from java.lang.Math.hypot in the last bit. */
    public static double hypot(double a, double b) {
        double x = Math.abs(a), y = Math.abs(b);
        if (Double.isNaN(a) || Double.isNaN(b)) {
            if (x == Double.POSITIVE_INFINITY || y == Double.POSITIVE_INFINITY) return Double.POSITIVE_INFINITY;
            return Double.NaN;
        }
        double max = Math.max(x, y);
        if (max == Double.POSITIVE_INFINITY) return Double.POSITIVE_INFINITY;
        if (max == 0) return 0;
        double sum = 0, compensation = 0;
        for (double v : new double[]{x, y}) {
            double n = v / max;
            double summand = n * n - compensation;
            double preliminary = sum + summand;
            compensation = (preliminary - sum) - summand;
            sum = preliminary;
        }
        return Math.sqrt(sum) * max;
    }

    public static double dist(Model.Pt a, Model.Pt b) {
        return hypot(a.x - b.x, a.y - b.y);
    }

    /** JavaScript's Math.round (halves round towards +infinity). */
    public static long round(double v) {
        return (long) Math.floor(v + 0.5);
    }
}
