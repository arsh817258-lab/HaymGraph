/**
 * HaymGraph Core Math Engine
 * Pure JavaScript - zero DOM, zero CEP dependencies.
 * Runs in Node.js unit tests and browser/CEP runtime.
 */

(function (root, factory) {
    if (typeof exports === 'object' && typeof module !== 'undefined') {
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else {
        root.HaymMath = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var EPSILON = 0.0001;
    var MIN_INFLUENCE = 0.1;
    var MAX_INFLUENCE = 100.0;

    /**
     * Clamps a value between min and max.
     */
    function clamp(val, min, max) {
        if (val < min) return min;
        if (val > max) return max;
        return val;
    }

    /**
     * Evaluates a cubic bezier at parameter t in [0, 1].
     */
    function evaluateBezier1D(p0, p1, p2, p3, t) {
        var u = 1 - t;
        return (u * u * u * p0) +
               (3 * u * u * t * p1) +
               (3 * u * t * t * p2) +
               (t * t * t * p3);
    }

    /**
     * Forward conversion: Cubic Bezier (x1, y1, x2, y2) -> AE KeyframeEase
     *
     * @param {Object} curve - { x1, y1, x2, y2 }
     * @param {number} deltaV - Change in value between keys (V2 - V1)
     * @param {number} deltaT - Duration between keys in seconds (t2 - t1)
     * @returns {Object} { outEase: { speed, influence }, inEase: { speed, influence } }
     */
    function bezierToEase(curve, deltaV, deltaT) {
        var x1 = clamp(Number(curve.x1), 0.0, 1.0);
        var y1 = Number(curve.y1);
        var x2 = clamp(Number(curve.x2), 0.0, 1.0);
        var y2 = Number(curve.y2);

        var dt = Math.abs(Number(deltaT));
        if (dt < EPSILON) dt = EPSILON;

        var dV = Number(deltaV);
        var vAvg = dV / dt;

        // Out-ease on first key:
        // influence clamped to AE valid range [0.1, 100]
        var outInfluence = clamp(Math.round(x1 * 1000000) / 10000.0, MIN_INFLUENCE, MAX_INFLUENCE);
        // The actual horizontal run of the handle in AE is effX1 = outInfluence / 100
        var effX1 = outInfluence / 100.0;
        var outSpeed = Math.round(((y1 / effX1) * vAvg) * 10000) / 10000;

        // In-ease on second key:
        // influence clamped to AE valid range [0.1, 100]
        var inInfluence = clamp(Math.round((1.0 - x2) * 1000000) / 10000.0, MIN_INFLUENCE, MAX_INFLUENCE);
        // The actual horizontal run of the incoming handle in AE is effDx2 = inInfluence / 100
        var effDx2 = inInfluence / 100.0;
        var inSpeed = Math.round((((1.0 - y2) / effDx2) * vAvg) * 10000) / 10000;

        return {
            outEase: {
                speed: outSpeed,
                influence: outInfluence
            },
            inEase: {
                speed: inSpeed,
                influence: inInfluence
            }
        };
    }

    /**
     * Inverse conversion: AE KeyframeEase -> Cubic Bezier (x1, y1, x2, y2)
     * Used by Analyze feature.
     *
     * @param {Object} outEase - { speed, influence } from first key
     * @param {Object} inEase - { speed, influence } from second key
     * @param {number} deltaV - Change in value (V2 - V1)
     * @param {number} deltaT - Duration in seconds
     * @returns {Object} { x1, y1, x2, y2 }
     */
    function easeToBezier(outEase, inEase, deltaV, deltaT) {
        var outInf = clamp(Number(outEase ? outEase.influence : 33.33), MIN_INFLUENCE, MAX_INFLUENCE);
        var inInf = clamp(Number(inEase ? inEase.influence : 33.33), MIN_INFLUENCE, MAX_INFLUENCE);
        var outSpd = Number(outEase ? outEase.speed : 0);
        var inSpd = Number(inEase ? inEase.speed : 0);

        var dt = Math.abs(Number(deltaT));
        if (dt < EPSILON) dt = EPSILON;
        var dV = Number(deltaV);

        var effX1 = outInf / 100.0;
        var effDx2 = inInf / 100.0;

        // Normalized X coordinates with boundary snapping for 0.0 and 1.0
        var x1 = effX1;
        if (x1 <= 0.0015) x1 = 0.0;
        if (x1 >= 0.999) x1 = 1.0;

        var x2 = 1.0 - effDx2;
        if (x2 <= 0.001) x2 = 0.0;
        if (x2 >= 0.9985) x2 = 1.0;

        var y1, y2;

        if (Math.abs(dV) < EPSILON) {
            // Fallback when deltaV is zero
            if (Math.abs(outSpd) < EPSILON && Math.abs(inSpd) < EPSILON) {
                y1 = 0.0;
                y2 = 1.0;
            } else {
                y1 = clamp(outSpd * dt * effX1, -2.0, 2.0);
                y2 = clamp(1.0 - (inSpd * dt * effDx2), -1.0, 3.0);
            }
        } else {
            var vAvg = dV / dt;
            y1 = (outSpd / vAvg) * effX1;
            y2 = 1.0 - ((inSpd / vAvg) * effDx2);
        }

        return {
            x1: Math.round(x1 * 1000) / 1000,
            y1: Math.round(y1 * 1000) / 1000,
            x2: Math.round(x2 * 1000) / 1000,
            y2: Math.round(y2 * 1000) / 1000
        };
    }

    /**
     * Computes the exact minimum and maximum y values of the cubic bezier curve
     * for t in [0, 1], finding roots of the derivative y'(t) = 0.
     *
     * y(t) = (1-t)^3(0) + 3(1-t)^2*t*y1 + 3(1-t)*t^2*y2 + t^3(1)
     * y'(t)/3 = (3y1 - 3y2 + 1)t^2 + (2y2 - 4y1)t + y1 = A t^2 + B t + C
     *
     * @param {Object} curve - { x1, y1, x2, y2 }
     * @returns {Object} { minY, maxY, hasOvershoot, isBelowZero, isAboveOne }
     */
    function computeCurveExtrema(curve) {
        var y1 = Number(curve.y1);
        var y2 = Number(curve.y2);

        var candidates = [0.0, 1.0];

        var a = (3.0 * y1) - (3.0 * y2) + 1.0;
        var b = (2.0 * y2) - (4.0 * y1);
        var c = y1;

        if (Math.abs(a) < 1e-9) {
            // Linear equation: b*t + c = 0
            if (Math.abs(b) > 1e-9) {
                var tLin = -c / b;
                if (tLin > 0.0 && tLin < 1.0) {
                    candidates.push(tLin);
                }
            }
        } else {
            var disc = (b * b) - (4.0 * a * c);
            if (disc >= 0) {
                var sqrtDisc = Math.sqrt(disc);
                var tRoot1 = (-b + sqrtDisc) / (2.0 * a);
                var tRoot2 = (-b - sqrtDisc) / (2.0 * a);
                if (tRoot1 > 0.0 && tRoot1 < 1.0) candidates.push(tRoot1);
                if (tRoot2 > 0.0 && tRoot2 < 1.0) candidates.push(tRoot2);
            }
        }

        var minY = Infinity;
        var maxY = -Infinity;

        for (var i = 0; i < candidates.length; i++) {
            var tVal = candidates[i];
            var yVal = evaluateBezier1D(0.0, y1, y2, 1.0, tVal);
            if (yVal < minY) minY = yVal;
            if (yVal > maxY) maxY = yVal;
        }

        var isBelowZero = minY < -0.001;
        var isAboveOne = maxY > 1.001;
        var hasOvershoot = isBelowZero || isAboveOne;

        return {
            minY: Math.round(minY * 1000) / 1000,
            maxY: Math.round(maxY * 1000) / 1000,
            hasOvershoot: hasOvershoot,
            isBelowZero: isBelowZero,
            isAboveOne: isAboveOne
        };
    }

    /**
     * Reverse (flip) a bezier curve:
     * (x1, y1, x2, y2) -> (1 - x2, 1 - y2, 1 - x1, 1 - y1)
     */
    function reverseCurve(curve) {
        var x1 = Number(curve.x1);
        var y1 = Number(curve.y1);
        var x2 = Number(curve.x2);
        var y2 = Number(curve.y2);

        return {
            x1: Math.round((1.0 - x2) * 1000) / 1000,
            y1: Math.round((1.0 - y2) * 1000) / 1000,
            x2: Math.round((1.0 - x1) * 1000) / 1000,
            y2: Math.round((1.0 - y1) * 1000) / 1000
        };
    }

    /**
     * Alt-mirror: reflect the opposite handle through the box center (0.5, 0.5)
     * (xOpposite, yOpposite) = (1 - xSource, 1 - ySource)
     */
    function mirrorHandle(sourceHandleIndex, sourceX, sourceY) {
        var targetX = clamp(1.0 - sourceX, 0.0, 1.0);
        var targetY = 1.0 - sourceY;
        return {
            x: Math.round(targetX * 1000) / 1000,
            y: Math.round(targetY * 1000) / 1000
        };
    }

    /**
     * Ctrl-mirror (Diagonal Ease Reflection across the 45-degree axis):
     * Reflects the handle vector across the main diagonal (0,0) -> (1,1):
     * (xOpposite, yOpposite) = (1 - ySource, 1 - xSource)
     *
     * Exact reference examples:
     * - P1: (0, 0.75)   -> P2: (1 - 0.75, 1 - 0)    = (0.25, 1.0)
     * - P1: (0, 0.50)   -> P2: (1 - 0.50, 1 - 0)    = (0.50, 1.0)
     * - P1: (0.25, 0)   -> P2: (1 - 0, 1 - 0.25)    = (1.0, 0.75)
     * - P1: (0.75, 0.25)-> P2: (1 - 0.25, 1 - 0.75) = (0.75, 0.25)
     */
    function mirrorDiagonalHandle(sourceHandleIndex, sourceX, sourceY) {
        var targetX = clamp(1.0 - sourceY, 0.0, 1.0);
        var targetY = 1.0 - sourceX;
        return {
            x: Math.round(targetX * 1000) / 1000,
            y: Math.round(targetY * 1000) / 1000
        };
    }

    /**
     * Flatten handle: zeroes the handle's speed
     * P1 goes to y = 0, P2 goes to y = 1, keeping x.
     */
    function flattenHandle(handleIndex, x) {
        return {
            x: clamp(x, 0.0, 1.0),
            y: handleIndex === 1 ? 0.0 : 1.0
        };
    }

    /**
     * Magnetic snapping for curve handles.
     * Snaps to flat (y=0 or 1), 45° diagonal (y=x), 0% line, 100% line, and grid lines.
     *
     * @param {number} handleIndex - 1 (P1) or 2 (P2)
     * @param {number} normX - current normalized X [0, 1]
     * @param {number} normY - current normalized Y
     * @param {Object} snapConfig - { thresholdX, thresholdY, bypassShift }
     * @returns {Object} { x, y, snappedX: boolean, snappedY: boolean, snapType: string|null }
     */
    function snapHandle(handleIndex, normX, normY, snapConfig) {
        var cfg = snapConfig || {};
        if (cfg.bypassShift) {
            return { x: normX, y: normY, snappedX: false, snappedY: false, snapType: null };
        }

        var threshX = cfg.thresholdX || 0.03;
        var threshY = cfg.thresholdY || 0.04;

        var resultX = normX;
        var resultY = normY;
        var snappedX = false;
        var snappedY = false;
        var snapType = null;

        // 1. Snapping Y to Flat / Baseline
        var flatTargetY = (handleIndex === 1) ? 0.0 : 1.0;
        if (Math.abs(normY - flatTargetY) <= threshY) {
            resultY = flatTargetY;
            snappedY = true;
            snapType = "flat";
        } else if (Math.abs(normY - 0.0) <= threshY) {
            resultY = 0.0;
            snappedY = true;
            snapType = "0%";
        } else if (Math.abs(normY - 1.0) <= threshY) {
            resultY = 1.0;
            snappedY = true;
            snapType = "100%";
        }

        // 2. Snapping to 45° Diagonal
        // For P1: diagonal is y = x
        // For P2: diagonal is (1 - y) = (1 - x) => y = x
        if (!snappedY && Math.abs(normY - normX) <= threshY) {
            resultY = normX;
            snappedY = true;
            snapType = "45deg";
        }

        // 3. Grid lines (0.25, 0.333, 0.5, 0.667, 0.75)
        var gridPoints = [0.25, 0.333, 0.5, 0.667, 0.75];
        if (!snappedX) {
            for (var i = 0; i < gridPoints.length; i++) {
                var gp = gridPoints[i];
                if (Math.abs(normX - gp) <= threshX) {
                    resultX = gp;
                    snappedX = true;
                    if (!snapType) snapType = "grid-x";
                    break;
                }
            }
        }
        if (!snappedY) {
            for (var j = 0; j < gridPoints.length; j++) {
                var gpy = gridPoints[j];
                if (Math.abs(normY - gpy) <= threshY) {
                    resultY = gpy;
                    snappedY = true;
                    if (!snapType) snapType = "grid-y";
                    break;
                }
            }
        }

        return {
            x: clamp(resultX, 0.0, 1.0),
            y: resultY,
            snappedX: snappedX,
            snappedY: snappedY,
            snapType: snapType
        };
    }

    return {
        clamp: clamp,
        evaluateBezier1D: evaluateBezier1D,
        bezierToEase: bezierToEase,
        easeToBezier: easeToBezier,
        computeCurveExtrema: computeCurveExtrema,
        reverseCurve: reverseCurve,
        mirrorHandle: mirrorHandle,
        mirrorDiagonalHandle: mirrorDiagonalHandle,
        flattenHandle: flattenHandle,
        snapHandle: snapHandle,
        EPSILON: EPSILON,
        MIN_INFLUENCE: MIN_INFLUENCE,
        MAX_INFLUENCE: MAX_INFLUENCE
    };
}));
