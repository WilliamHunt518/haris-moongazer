package server.strattac;

/**
 * Mulberry32, bit-for-bit the same as the study's SeededRNG (src/utils/prng.ts), so a seed produces the same
 * mission stream, failure draws and assistant behaviour in HARIS as it did in the original study.
 */
public final class Rng {
    private int s;

    public Rng(long seed) {
        this.s = (int) seed;
    }

    /** A float in [0, 1). */
    public double next() {
        s += 0x6d2b79f5;
        int z = s;
        z = (z ^ (z >>> 15)) * (z | 1);
        z ^= z + ((z ^ (z >>> 7)) * (z | 61));
        return ((z ^ (z >>> 14)) & 0xffffffffL) / 4294967296.0;
    }

    /** An integer in [min, max). */
    public int randInt(int min, int max) {
        return (int) Math.floor(next() * (max - min)) + min;
    }

    public double randFloat(double min, double max) {
        return next() * (max - min) + min;
    }

    public <T> T weightedChoice(T[] items, double[] weights) {
        double total = 0;
        for (double w : weights) total += w;
        double r = next() * total;
        for (int i = 0; i < items.length; i++) {
            r -= weights[i];
            if (r <= 0) return items[i];
        }
        return items[items.length - 1];
    }

    public double exponential(double mean) {
        return -mean * StrictMath.log(1 - next());
    }

    /** JavaScript's {@code x >>> 0} for a value already reduced to 32 bits. */
    public static long u32(long x) {
        return x & 0xffffffffL;
    }

    /** The study's hashId: reduce((acc ^ (charCode * (i + 7))) >>> 0, 0). */
    public static long hashId(String id) {
        long acc = 0;
        for (int i = 0; i < id.length(); i++) acc = u32(acc ^ ((long) id.charAt(i) * (i + 7)));
        return acc;
    }

    /** JavaScript's Math.imul. */
    public static int imul(long a, long b) {
        return (int) a * (int) b;
    }
}
