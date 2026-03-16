/**
 * Luminosity inversion in HLS color space (WGSL helper functions).
 *
 * Algorithm: Python colorsys.rgb_to_hls / hls_to_rgb, ported to WGSL.
 * Inverts only the Lightness channel — hue and saturation are preserved.
 *
 * Input is clamped to [0,1] before conversion. HDR values (>1.0) are
 * tone-mapped to 1.0 before inversion, so bloom regions become dark
 * and dark regions become bright. This matches the behavior of the
 * reference Python implementation (PIL 8-bit images).
 *
 * Injected into each shader via template interpolation before the
 * fragment function. Called as: invert_luminosity(color.rgb)
 */

export const LUM_INVERT_WGSL = /* wgsl */ `

// ─── HLS luminosity inversion (colorsys algorithm) ──────────────────

fn rgb_to_hls(c: vec3f) -> vec3f {
    let mx  = max(c.r, max(c.g, c.b));
    let mn  = min(c.r, min(c.g, c.b));
    let sm  = mx + mn;
    let rng = mx - mn;
    let l   = sm * 0.5;

    // Achromatic — no hue or saturation
    if (rng < 0.0001) {
        return vec3f(0.0, l, 0.0);
    }

    let s = select(rng / (2.0 - sm), rng / sm, l <= 0.5);

    let rc = (mx - c.r) / rng;
    let gc = (mx - c.g) / rng;
    let bc = (mx - c.b) / rng;

    var h: f32;
    if (c.r >= c.g && c.r >= c.b) {
        h = bc - gc;
    } else if (c.g >= c.b) {
        h = 2.0 + rc - bc;
    } else {
        h = 4.0 + gc - rc;
    }
    h = h / 6.0;
    h = h - floor(h);  // mod 1.0 — handles negatives correctly

    return vec3f(h, l, s);
}

fn hue_val(m1: f32, m2: f32, hue_in: f32) -> f32 {
    var hue = hue_in - floor(hue_in);  // mod 1.0
    if (hue < 1.0 / 6.0) {
        return m1 + (m2 - m1) * hue * 6.0;
    }
    if (hue < 0.5) {
        return m2;
    }
    if (hue < 2.0 / 3.0) {
        return m1 + (m2 - m1) * (2.0 / 3.0 - hue) * 6.0;
    }
    return m1;
}

fn hls_to_rgb(hls: vec3f) -> vec3f {
    let h = hls.x;
    let l = hls.y;
    let s = hls.z;
    if (s < 0.0001) {
        return vec3f(l);
    }
    let m2 = select(l + s - l * s, l * (1.0 + s), l <= 0.5);
    let m1 = 2.0 * l - m2;
    return vec3f(
        hue_val(m1, m2, h + 1.0 / 3.0),
        hue_val(m1, m2, h),
        hue_val(m1, m2, h - 1.0 / 3.0),
    );
}

fn invert_luminosity(c: vec3f) -> vec3f {
    let clamped = clamp(c, vec3f(0.0), vec3f(1.0));
    let hls = rgb_to_hls(clamped);
    return hls_to_rgb(vec3f(hls.x, 1.0 - hls.y, hls.z));
}
`;
