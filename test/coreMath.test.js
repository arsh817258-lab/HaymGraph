const test = require('node:test');
const assert = require('node:assert/strict');
const HaymMath = require('../js/coreMath.js');

test('Cubic Bezier to AE KeyframeEase conversion', async (t) => {
    await t.test('Linear curve (0.333, 0.333, 0.667, 0.667)', () => {
        const curve = { x1: 0.3333, y1: 0.3333, x2: 0.6667, y2: 0.6667 };
        const deltaV = 100;
        const deltaT = 1.0;
        const res = HaymMath.bezierToEase(curve, deltaV, deltaT);

        // influence = x1 * 100 ~ 33.33%
        assert.ok(Math.abs(res.outEase.influence - 33.33) < 0.1);
        // speed = (y1/x1) * (100/1) = 1.0 * 100 = 100
        assert.ok(Math.abs(res.outEase.speed - 100) < 0.1);

        // inEase influence = (1 - 0.6667)*100 ~ 33.33%
        assert.ok(Math.abs(res.inEase.influence - 33.33) < 0.1);
        // inEase speed = ((1-y2)/(1-x2)) * 100 = 100
        assert.ok(Math.abs(res.inEase.speed - 100) < 0.1);
    });

    await t.test('Ease In Out standard (0.333, 0.0, 0.667, 1.0)', () => {
        const curve = { x1: 0.3333, y1: 0.0, x2: 0.6667, y2: 1.0 };
        const deltaV = 500;
        const deltaT = 2.0; // vAvg = 250
        const res = HaymMath.bezierToEase(curve, deltaV, deltaT);

        assert.ok(Math.abs(res.outEase.influence - 33.33) < 0.1);
        assert.ok(Math.abs(res.outEase.speed - 0) < 0.01);

        assert.ok(Math.abs(res.inEase.influence - 33.33) < 0.1);
        assert.ok(Math.abs(res.inEase.speed - 0) < 0.01);
    });

    await t.test('Overshoot curve (0.2, 1.5, 0.8, 1.2)', () => {
        const curve = { x1: 0.2, y1: 1.5, x2: 0.8, y2: 1.2 };
        const deltaV = 100;
        const deltaT = 1.0;
        const res = HaymMath.bezierToEase(curve, deltaV, deltaT);

        assert.equal(res.outEase.influence, 20.0);
        // speed = (1.5 / 0.2) * 100 = 7.5 * 100 = 750
        assert.equal(res.outEase.speed, 750);

        assert.equal(res.inEase.influence, 20.0);
        // (1 - 1.2)/(1 - 0.8) = -0.2 / 0.2 = -1.0 * 100 = -100
        assert.equal(res.inEase.speed, -100);
    });

    await t.test('Divide-by-zero protection at x1=0 and x2=1', () => {
        const curve = { x1: 0.0, y1: 0.5, x2: 1.0, y2: 0.5 };
        const deltaV = 100;
        const deltaT = 1.0;
        const res = HaymMath.bezierToEase(curve, deltaV, deltaT);

        // Influence clamped to minimum 0.1%
        assert.equal(res.outEase.influence, 0.1);
        assert.equal(res.inEase.influence, 0.1);
        assert.ok(isFinite(res.outEase.speed));
        assert.ok(isFinite(res.inEase.speed));
    });
});

test('Inverse conversion: AE KeyframeEase -> Cubic Bezier (Analyze)', async (t) => {
    await t.test('Roundtrip fidelity for standard ease', () => {
        const originalCurve = { x1: 0.4, y1: 0.1, x2: 0.7, y2: 0.9 };
        const deltaV = 200;
        const deltaT = 1.0;

        const eases = HaymMath.bezierToEase(originalCurve, deltaV, deltaT);
        const reconstructed = HaymMath.easeToBezier(eases.outEase, eases.inEase, deltaV, deltaT);

        assert.ok(Math.abs(reconstructed.x1 - originalCurve.x1) < 0.01);
        assert.ok(Math.abs(reconstructed.y1 - originalCurve.y1) < 0.01);
        assert.ok(Math.abs(reconstructed.x2 - originalCurve.x2) < 0.01);
        assert.ok(Math.abs(reconstructed.y2 - originalCurve.y2) < 0.01);
    });

    await t.test('Fallback when deltaV is zero', () => {
        const outEase = { speed: 0, influence: 50 };
        const inEase = { speed: 0, influence: 50 };
        const bezier = HaymMath.easeToBezier(outEase, inEase, 0, 1.0);

        assert.equal(bezier.x1, 0.5);
        assert.equal(bezier.y1, 0.0);
        assert.equal(bezier.x2, 0.5);
        assert.equal(bezier.y2, 1.0);
    });
});

test('Bezier Extrema and Overshoot Detection', async (t) => {
    await t.test('Standard curve within [0, 1] bounds', () => {
        const curve = { x1: 0.3, y1: 0.0, x2: 0.7, y2: 1.0 };
        const extrema = HaymMath.computeCurveExtrema(curve);

        assert.equal(extrema.hasOvershoot, false);
        assert.equal(extrema.isBelowZero, false);
        assert.equal(extrema.isAboveOne, false);
        assert.ok(extrema.minY >= 0);
        assert.ok(extrema.maxY <= 1.0);
    });

    await t.test('Curve with positive overshoot (anticipation or bounce)', () => {
        const curve = { x1: 0.2, y1: 1.6, x2: 0.6, y2: 1.2 };
        const extrema = HaymMath.computeCurveExtrema(curve);

        assert.equal(extrema.hasOvershoot, true);
        assert.equal(extrema.isAboveOne, true);
        assert.ok(extrema.maxY > 1.05);
    });

    await t.test('Curve with negative anticipation overshoot (drops below 0)', () => {
        const curve = { x1: 0.4, y1: -0.4, x2: 0.7, y2: 1.0 };
        const extrema = HaymMath.computeCurveExtrema(curve);

        assert.equal(extrema.hasOvershoot, true);
        assert.equal(extrema.isBelowZero, true);
        assert.ok(extrema.minY < -0.05);
    });
});

test('Transformations: Reverse, Mirror, Flatten, Snapping', async (t) => {
    await t.test('Reverse (flip) curve', () => {
        const curve = { x1: 0.2, y1: 0.1, x2: 0.8, y2: 0.9 };
        const rev = HaymMath.reverseCurve(curve);

        // (x1, y1, x2, y2) -> (1 - x2, 1 - y2, 1 - x1, 1 - y1)
        assert.equal(rev.x1, 0.2); // 1 - 0.8
        assert.equal(rev.y1, 0.1); // 1 - 0.9
        assert.equal(rev.x2, 0.8); // 1 - 0.2
        assert.equal(rev.y2, 0.9); // 1 - 0.1
    });

    await t.test('Alt-mirror handle', () => {
        const mirrored = HaymMath.mirrorHandle(1, 0.3, 0.2);
        assert.equal(mirrored.x, 0.7); // 1 - 0.3
        assert.equal(mirrored.y, 0.8); // 1 - 0.2
    });

    await t.test('Ctrl-mirror diagonal handle (ease reflection)', () => {
        // Dragging P1 to (0.6, 0.05) [Ease-In] diagonally mirrors P2 to (0.05, 0.6)
        const diag1 = HaymMath.mirrorDiagonalHandle(1, 0.6, 0.05);
        assert.equal(diag1.x, 0.05);
        assert.equal(diag1.y, 0.6);

        // Dragging P2 to (0.3, 1.0) diagonally mirrors P1 to (1.0, 0.3)
        const diag2 = HaymMath.mirrorDiagonalHandle(2, 0.3, 1.0);
        assert.equal(diag2.x, 1.0);
        assert.equal(diag2.y, 0.3);
    });

    await t.test('Flatten handles', () => {
        const flat1 = HaymMath.flattenHandle(1, 0.4);
        assert.equal(flat1.x, 0.4);
        assert.equal(flat1.y, 0.0);

        const flat2 = HaymMath.flattenHandle(2, 0.6);
        assert.equal(flat2.x, 0.6);
        assert.equal(flat2.y, 1.0);
    });

    await t.test('Magnetic snapping to flat and 45deg', () => {
        // Snap P1 to flat y=0
        const snapFlat = HaymMath.snapHandle(1, 0.3, 0.02, { thresholdY: 0.04 });
        assert.equal(snapFlat.snappedY, true);
        assert.equal(snapFlat.y, 0.0);

        // Snap P1 to 45 deg diagonal
        const snapDiag = HaymMath.snapHandle(1, 0.5, 0.52, { thresholdY: 0.04 });
        assert.equal(snapDiag.snappedY, true);
        assert.equal(snapDiag.y, 0.5);

        // Shift bypass
        const snapBypass = HaymMath.snapHandle(1, 0.5, 0.52, { bypassShift: true });
        assert.equal(snapBypass.snappedY, false);
        assert.equal(snapBypass.y, 0.52);
    });
});
