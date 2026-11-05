/**
 * HaymGraph - ExtendScript Engine for Adobe After Effects
 * Handles cubic bezier <-> temporal keyframe ease conversion,
 * multi-property application, and Position Overshoot separation.
 */

if (typeof JSON !== "object") {
    JSON = {};
}
(function () {
    "use strict";
    var rx_one = /^[\],:{}\s]*$/;
    var rx_two = /\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g;
    var rx_three = /"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g;
    var rx_four = /(?:^|:|,)(?:\s*\[)+/g;
    var rx_escapable = /[\\"\u0000-\u001f\u007f-\u009f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g;
    var rx_dangerous = /[\u0000\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g;

    function quote(string) {
        rx_escapable.lastIndex = 0;
        return rx_escapable.test(string) ? '"' + string.replace(rx_escapable, function (a) {
            var c = { '\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r', '"': '\\"', '\\': '\\\\' }[a];
            return typeof c === 'string' ? c : '\\u' + ('0000' + a.charCodeAt(0).toString(16)).slice(-4);
        }) + '"' : '"' + string + '"';
    }

    if (typeof JSON.stringify !== "function") {
        JSON.stringify = function (value) {
            if (value === null) return "null";
            if (typeof value === "number") return isFinite(value) ? String(value) : "null";
            if (typeof value === "boolean") return String(value);
            if (typeof value === "string") return quote(value);
            if (typeof value === "object") {
                if (Object.prototype.toString.apply(value) === "[object Array]") {
                    var a = [];
                    for (var i = 0; i < value.length; i++) a.push(JSON.stringify(value[i]) || "null");
                    return "[" + a.join(",") + "]";
                }
                var o = [];
                for (var k in value) {
                    if (Object.prototype.hasOwnProperty.call(value, k)) {
                        var v = JSON.stringify(value[k]);
                        if (v) o.push(quote(k) + ":" + v);
                    }
                }
                return "{" + o.join(",") + "}";
            }
            return undefined;
        };
    }

    if (typeof JSON.parse !== "function") {
        JSON.parse = function (text) {
            text = String(text);
            rx_dangerous.lastIndex = 0;
            if (rx_dangerous.test(text)) {
                text = text.replace(rx_dangerous, function (a) {
                    return "\\u" + ("0000" + a.charCodeAt(0).toString(16)).slice(-4);
                });
            }
            if (rx_one.test(text.replace(rx_two, "@").replace(rx_three, "]").replace(rx_four, ""))) {
                return eval("(" + text + ")");
            }
            throw new SyntaxError("JSON.parse");
        };
    }
}());

var HaymHost = (function () {
    "use strict";

    var EPSILON = 0.0001;
    var MIN_INFLUENCE = 0.1;
    var MAX_INFLUENCE = 100.0;

    function clamp(val, min, max) {
        if (val < min) return min;
        if (val > max) return max;
        return val;
    }

    /**
     * Checks if a property is a spatial non-separated position property.
     */
    function isSpatialNonSeparatedPosition(prop) {
        if (!prop || !prop.canVaryOverTime) return false;
        try {
            if (prop.matchName === "ADBE Position") {
                if (prop.isSpatial && !prop.dimensionsSeparated) {
                    return true;
                }
            }
        } catch (e) { }
        return false;
    }

    /**
     * Calculates path distance (scalar deltaV) for spatial properties.
     */
    function calculateSpatialDistance(val1, val2) {
        if (!val1 || !val2) return 0;
        var dx = (val2[0] || 0) - (val1[0] || 0);
        var dy = (val2[1] || 0) - (val1[1] || 0);
        var dz = (val2[2] || 0) - (val1[2] || 0);
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    /**
     * Rove Across Time Helper: Checks if a keyframe roves across time.
     */
    function isKeyRoving(prop, kIndex) {
        if (!prop || !kIndex) return false;
        try {
            if (typeof prop.keyRoving === "function") {
                return prop.keyRoving(kIndex) === true;
            }
        } catch (e) { }
        return false;
    }

    /**
     * Sets or restores roving status for a keyframe.
     */
    function setKeyRoving(prop, kIndex, isRoving) {
        if (!prop || !kIndex) return;
        try {
            if (typeof prop.setRovingAtKeyframe === "function") {
                prop.setRovingAtKeyframe(kIndex, isRoving);
                return;
            }
        } catch (e) { }
        try {
            if (typeof prop.setRovingAtKey === "function") {
                prop.setRovingAtKey(kIndex, isRoving);
            }
        } catch (e2) { }
    }

    /**
     * Finds the nearest preceding non-roving anchor key.
     */
    function findPrevNonRoving(prop, k) {
        if (!isKeyRoving(prop, k)) return k;
        for (var i = k - 1; i >= 1; i--) {
            if (!isKeyRoving(prop, i)) return i;
        }
        return 1;
    }

    /**
     * Finds the nearest succeeding non-roving anchor key.
     */
    function findNextNonRoving(prop, k) {
        if (!isKeyRoving(prop, k)) return k;
        for (var i = k + 1; i <= prop.numKeys; i++) {
            if (!isKeyRoving(prop, i)) return i;
        }
        return prop.numKeys;
    }

    /**
     * Resolves selected keys into animation segments between non-roving anchor keys.
     * Intermediate roving keyframes are preserved and handled smoothly across the span,
     * matching native After Effects Graph Editor behavior.
     */
    function getPropertySegments(prop, sortedKeys) {
        if (!sortedKeys || sortedKeys.length === 0) return [];

        var anchorIndices = [];
        var anchorMap = {};

        function addAnchor(idx) {
            if (idx >= 1 && idx <= prop.numKeys && !anchorMap[idx]) {
                anchorMap[idx] = true;
                anchorIndices.push(idx);
            }
        }

        if (sortedKeys.length === 1) {
            var k = sortedKeys[0];
            if (isKeyRoving(prop, k)) {
                addAnchor(findPrevNonRoving(prop, k));
                addAnchor(findNextNonRoving(prop, k));
            } else {
                if (k < prop.numKeys) {
                    addAnchor(k);
                    addAnchor(findNextNonRoving(prop, k + 1));
                } else if (k > 1) {
                    addAnchor(findPrevNonRoving(prop, k - 1));
                    addAnchor(k);
                }
            }
        } else {
            for (var i = 0; i < sortedKeys.length; i++) {
                var keyIdx = sortedKeys[i];
                if (isKeyRoving(prop, keyIdx)) {
                    addAnchor(findPrevNonRoving(prop, keyIdx));
                    addAnchor(findNextNonRoving(prop, keyIdx));
                } else {
                    addAnchor(keyIdx);
                }
            }
        }

        anchorIndices.sort(function (a, b) { return a - b; });

        var segments = [];
        for (var j = 0; j < anchorIndices.length - 1; j++) {
            var a1 = anchorIndices[j];
            var a2 = anchorIndices[j + 1];
            if (a1 < a2) {
                segments.push([a1, a2]);
            }
        }

        return segments;
    }

    /**
     * Gathers all selected properties across all selected layers
     * or active composition, filtering out unsupported types.
     */
    function getSelectedProperties(comp) {
        var props = [];
        var seen = {};

        function isSupportedProperty(p) {
            if (!p || p.propertyType !== PropertyType.PROPERTY || !p.canVaryOverTime) return false;
            try {
                var vt = p.propertyValueType;
                // Exclude text documents, markers, and custom data
                if (vt === PropertyValueType.TEXT_DOCUMENT ||
                    vt === PropertyValueType.CUSTOM_VALUE ||
                    vt === PropertyValueType.NO_VALUE) {
                    return false;
                }
                return true;
            } catch (e) {
                return false;
            }
        }

        // 1. Direct comp.selectedProperties
        try {
            var compSelected = comp.selectedProperties;
            if (compSelected && compSelected.length > 0) {
                for (var i = 0; i < compSelected.length; i++) {
                    var p = compSelected[i];
                    if (isSupportedProperty(p)) {
                        var id = p.parentProperty ? (p.parentProperty.name + "_" + p.name + "_" + p.propertyIndex) : p.name;
                        if (!seen[id]) {
                            seen[id] = true;
                            props.push(p);
                        }
                    }
                }
            }
        } catch (e) { }

        // 2. Iterate selected layers
        try {
            var selectedLayers = comp.selectedLayers;
            for (var l = 0; l < selectedLayers.length; l++) {
                var layer = selectedLayers[l];
                var layerProps = layer.selectedProperties;
                if (layerProps) {
                    for (var j = 0; j < layerProps.length; j++) {
                        var lp = layerProps[j];
                        if (isSupportedProperty(lp)) {
                            var lid = layer.index + "_" + lp.name + "_" + lp.propertyIndex;
                            if (!seen[lid]) {
                                seen[lid] = true;
                                props.push(lp);
                            }
                        }
                    }
                }
            }
        } catch (e) { }

        return props;
    }

    /**
     * Checks if current selection has any spatial non-separated Position keyframes.
     */
    function checkSelectionStatus() {
        var comp = app.project ? app.project.activeItem : null;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({
                hasComp: false,
                totalKeys: 0,
                hasSpatialPosition: false,
                message: "No active composition."
            });
        }

        var props = getSelectedProperties(comp);
        var totalSelectedKeys = 0;
        var hasSpatialPosition = false;

        for (var i = 0; i < props.length; i++) {
            var prop = props[i];
            var keys = prop.selectedKeys;
            if (keys && keys.length > 0) {
                totalSelectedKeys += keys.length;
                if (isSpatialNonSeparatedPosition(prop)) {
                    hasSpatialPosition = true;
                }
            }
        }

        return JSON.stringify({
            hasComp: true,
            propsCount: props.length,
            totalKeys: totalSelectedKeys,
            hasSpatialPosition: hasSpatialPosition
        });
    }

    /**
     * Applies curve to a single segment (key1 -> key2) on a property.
     */
    function applyCurveToSegment(prop, k1, k2, curve) {
        var t1 = prop.keyTime(k1);
        var t2 = prop.keyTime(k2);
        var dt = Math.abs(t2 - t1);
        if (dt < EPSILON) dt = EPSILON;

        var v1 = prop.keyValue(k1);
        var v2 = prop.keyValue(k2);

        var x1 = clamp(Number(curve.x1), 0.0, 1.0);
        var y1 = Number(curve.y1);
        var x2 = clamp(Number(curve.x2), 0.0, 1.0);
        var y2 = Number(curve.y2);

        var outInfluence = clamp(x1 * 100.0, MIN_INFLUENCE, MAX_INFLUENCE);
        var inInfluence = clamp((1.0 - x2) * 100.0, MIN_INFLUENCE, MAX_INFLUENCE);

        // Actual horizontal run of handles in AE normalized time:
        var effX1 = outInfluence / 100.0;
        var effDx2 = inInfluence / 100.0;

        // Ensure keyframe interpolation is BEZIER and roving is OFF on anchors
        try {
            setKeyRoving(prop, k1, false);
            setKeyRoving(prop, k2, false);
        } catch (e) { }

        try {
            prop.setInterpolationTypeAtKey(k1, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
            prop.setInterpolationTypeAtKey(k2, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
        } catch (e) { }

        var valType = prop.propertyValueType;

        if (prop.isSpatial) {
            // Spatial property (Position): speed along path through intermediate roving keys
            var dist = 0;
            if (k2 === k1 + 1) {
                dist = calculateSpatialDistance(v1, v2);
            } else {
                for (var segK = k1; segK < k2; segK++) {
                    dist += calculateSpatialDistance(prop.keyValue(segK), prop.keyValue(segK + 1));
                }
            }
            var vAvgSpatial = dist / dt;

            var outSpeedSpatial = (y1 / effX1) * vAvgSpatial;
            var inSpeedSpatial = ((1.0 - y2) / effDx2) * vAvgSpatial;

            // In spatial properties without separated dimensions, speed cannot be negative
            if (outSpeedSpatial < 0) outSpeedSpatial = 0;
            if (inSpeedSpatial < 0) inSpeedSpatial = 0;

            var currentIn1 = prop.keyInTemporalEase(k1);
            var currentOut2 = prop.keyOutTemporalEase(k2);

            var newOut1 = [new KeyframeEase(outSpeedSpatial, outInfluence)];
            var newIn2 = [new KeyframeEase(inSpeedSpatial, inInfluence)];

            prop.setTemporalEaseAtKey(k1, currentIn1, newOut1);
            prop.setTemporalEaseAtKey(k2, newIn2, currentOut2);

            // Preserve intermediate roving keyframes so Rove Across Time is never broken
            for (var r = k1 + 1; r < k2; r++) {
                setKeyRoving(prop, r, true);
            }
        } else if (valType === PropertyValueType.TwoD || valType === PropertyValueType.ThreeD) {
            // Multi-dimensional non-spatial (Scale, etc.): one ease per dimension
            var dims = (valType === PropertyValueType.ThreeD) ? 3 : 2;
            var currentInArray1 = prop.keyInTemporalEase(k1);
            var currentOutArray2 = prop.keyOutTemporalEase(k2);

            var newOutArray1 = [];
            var newInArray2 = [];

            for (var d = 0; d < dims; d++) {
                var dV_d = (v2[d] || 0) - (v1[d] || 0);
                var vAvg_d = dV_d / dt;

                var outSpd_d = (y1 / effX1) * vAvg_d;
                var inSpd_d = ((1.0 - y2) / effDx2) * vAvg_d;

                newOutArray1.push(new KeyframeEase(outSpd_d, outInfluence));
                newInArray2.push(new KeyframeEase(inSpd_d, inInfluence));
            }

            prop.setTemporalEaseAtKey(k1, currentInArray1, newOutArray1);
            prop.setTemporalEaseAtKey(k2, newInArray2, currentOutArray2);
        } else if (valType === PropertyValueType.OneD || valType === PropertyValueType.COLOR) {
            // 1D property (Opacity, Rotation, Slider, Color):
            var dV = Number(v2) - Number(v1);
            var vAvg = dV / dt;

            var outSpd = (y1 / effX1) * vAvg;
            var inSpd = ((1.0 - y2) / effDx2) * vAvg;

            var curIn1 = prop.keyInTemporalEase(k1);
            var curOut2 = prop.keyOutTemporalEase(k2);

            var nOut1 = [new KeyframeEase(outSpd, outInfluence)];
            var nIn2 = [new KeyframeEase(inSpd, inInfluence)];

            prop.setTemporalEaseAtKey(k1, curIn1, nOut1);
            prop.setTemporalEaseAtKey(k2, nIn2, curOut2);
        }
    }

    /**
     * Direct Apply API: Accepts raw numbers directly, bypassing JSON.parse entirely.
     */
    function applyBezierValues(x1, y1, x2, y2) {
        return applyBezierWithCurve({
            x1: Number(x1),
            y1: Number(y1),
            x2: Number(x2),
            y2: Number(y2)
        });
    }

    /**
     * Main Apply API: Accepts JSON payload or parsed object.
     */
    function applyBezier(payloadJson) {
        var payload;
        if (typeof payloadJson === "object" && payloadJson !== null) {
            payload = payloadJson;
        } else {
            try {
                // Direct eval is fast and avoids regex quirks in ExtendScript
                payload = eval("(" + payloadJson + ")");
            } catch (e) {
                try {
                    payload = JSON.parse(payloadJson);
                } catch (e2) {
                    return JSON.stringify({ success: false, message: "Invalid JSON payload: " + e2.toString() });
                }
            }
        }

        var curve = (payload && payload.curve) ? payload.curve : payload;
        if (!curve) {
            return JSON.stringify({ success: false, message: "No curve specified in payload." });
        }

        return applyBezierWithCurve(curve);
    }

    function applyBezierWithCurve(curve) {

        var comp = app.project ? app.project.activeItem : null;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ success: false, message: "No active composition found." });
        }

        var props = getSelectedProperties(comp);
        if (props.length === 0) {
            return JSON.stringify({ success: false, message: "No properties with keyframes selected." });
        }

        app.beginUndoGroup("HaymGraph Apply Curve");

        var appliedKeysCount = 0;
        var appliedPropsCount = 0;
        var warnings = [];

        try {
            for (var p = 0; p < props.length; p++) {
                var prop = props[p];
                var selKeys = prop.selectedKeys;
                if (!selKeys || selKeys.length === 0) continue;

                // Sort keys by index ascending
                var sortedKeys = [];
                for (var k = 0; k < selKeys.length; k++) {
                    sortedKeys.push(selKeys[k]);
                }
                sortedKeys.sort(function (a, b) { return a - b; });

                var propHadApply = false;

                var segments = getPropertySegments(prop, sortedKeys);
                for (var s = 0; s < segments.length; s++) {
                    var seg = segments[s];
                    applyCurveToSegment(prop, seg[0], seg[1], curve);
                    appliedKeysCount += 1;
                    propHadApply = true;
                }

                if (propHadApply) {
                    appliedPropsCount++;
                }
            }
        } catch (err) {
            app.endUndoGroup();
            return JSON.stringify({
                success: false,
                message: "Error applying curve: " + err.toString()
            });
        }

        app.endUndoGroup();

        if (appliedKeysCount === 0) {
            return JSON.stringify({
                success: false,
                message: "No applicable keyframe segments found in selection."
            });
        }

        return JSON.stringify({
            success: true,
            keysCount: appliedKeysCount,
            propsCount: appliedPropsCount,
            message: "Applied to " + appliedKeysCount + " segment(s) on " + appliedPropsCount + " property(ies).",
            warnings: warnings
        });
    }

    /**
     * Calculates the cubic bezier curve for a single keyframe segment (k1 -> k2).
     */
    function analyzeSegmentCurve(prop, k1, k2) {
        var t1 = prop.keyTime(k1);
        var t2 = prop.keyTime(k2);
        var dt = Math.abs(t2 - t1);
        if (dt < EPSILON) dt = EPSILON;

        var v1 = prop.keyValue(k1);
        var v2 = prop.keyValue(k2);

        var outEaseArr = prop.keyOutTemporalEase(k1);
        var inEaseArr = prop.keyInTemporalEase(k2);

        var outEase = outEaseArr && outEaseArr.length > 0 ? outEaseArr[0] : null;
        var inEase = inEaseArr && inEaseArr.length > 0 ? inEaseArr[0] : null;

        var dV = 0;
        if (prop.isSpatial) {
            if (k2 === k1 + 1) {
                dV = calculateSpatialDistance(v1, v2);
            } else {
                for (var segK = k1; segK < k2; segK++) {
                    dV += calculateSpatialDistance(prop.keyValue(segK), prop.keyValue(segK + 1));
                }
            }
        } else if (prop.propertyValueType === PropertyValueType.TwoD || prop.propertyValueType === PropertyValueType.ThreeD) {
            var dims = (prop.propertyValueType === PropertyValueType.ThreeD) ? 3 : 2;
            var maxDelta = 0;
            var bestDim = 0;
            for (var d = 0; d < dims; d++) {
                var diff = Math.abs((v2[d] || 0) - (v1[d] || 0));
                if (diff > maxDelta) {
                    maxDelta = diff;
                    bestDim = d;
                }
            }
            dV = (v2[bestDim] || 0) - (v1[bestDim] || 0);
            if (outEaseArr && outEaseArr[bestDim]) outEase = outEaseArr[bestDim];
            if (inEaseArr && inEaseArr[bestDim]) inEase = inEaseArr[bestDim];
        } else {
            dV = Number(v2) - Number(v1);
        }

        var outInf = clamp(outEase ? outEase.influence : 33.33, MIN_INFLUENCE, MAX_INFLUENCE);
        var inInf = clamp(inEase ? inEase.influence : 33.33, MIN_INFLUENCE, MAX_INFLUENCE);
        var outSpd = Number(outEase ? outEase.speed : 0);
        var inSpd = Number(inEase ? inEase.speed : 0);

        var effX1 = outInf / 100.0;
        var effDx2 = inInf / 100.0;

        // Normalized X coordinates with boundary snapping for 0.0 and 1.0
        var x1 = effX1;
        if (x1 <= 0.0015) x1 = 0.0;
        if (x1 >= 0.999) x1 = 1.0;

        var x2 = 1.0 - effDx2;
        if (x2 <= 0.001) x2 = 0.0;
        if (x2 >= 0.9985) x2 = 1.0;

        var y1 = 0.0;
        var y2 = 1.0;

        if (Math.abs(dV) >= EPSILON) {
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
     * Analyze API: Reads selected keys' eases across all selected properties,
     * converts back to bezier, and reports if mixed curves or different properties exist.
     */
    function analyzeSelection() {
        var comp = app.project ? app.project.activeItem : null;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ success: false, message: "No active composition found." });
        }

        var props = getSelectedProperties(comp);
        if (props.length === 0) {
            return JSON.stringify({ success: false, message: "No properties with keyframes selected." });
        }

        var firstCurve = null;
        var hasMixedCurves = false;
        var propNames = [];
        var propNamesMap = {};
        var totalSegments = 0;
        var totalKeysCount = 0;

        for (var p = 0; p < props.length; p++) {
            var prop = props[p];
            var selKeys = prop.selectedKeys;
            if (!selKeys || selKeys.length === 0) continue;

            totalKeysCount += selKeys.length;
            var pName = prop.name || "Property";
            if (!propNamesMap[pName]) {
                propNamesMap[pName] = true;
                propNames.push(pName);
            }

            var sortedKeys = [];
            for (var k = 0; k < selKeys.length; k++) sortedKeys.push(selKeys[k]);
            sortedKeys.sort(function (a, b) { return a - b; });

            var pairs = getPropertySegments(prop, sortedKeys);

            for (var j = 0; j < pairs.length; j++) {
                var pair = pairs[j];
                var curCurve = analyzeSegmentCurve(prop, pair[0], pair[1]);
                totalSegments++;

                if (!firstCurve) {
                    firstCurve = curCurve;
                } else {
                    // Check if this segment differs from first curve
                    var diff = Math.abs(curCurve.x1 - firstCurve.x1) +
                        Math.abs(curCurve.y1 - firstCurve.y1) +
                        Math.abs(curCurve.x2 - firstCurve.x2) +
                        Math.abs(curCurve.y2 - firstCurve.y2);
                    if (diff > 0.05) {
                        hasMixedCurves = true;
                    }
                }
            }
        }

        if (!firstCurve) {
            return JSON.stringify({ success: false, message: "No keyframe pairs found to analyze." });
        }

        var differentPropsCount = propNames.length;
        var hasDifferentProperties = hasMixedCurves;

        var msg = "";
        if (hasMixedCurves) {
            msg = "Mixed curves detected" + (differentPropsCount > 1 ? (" (" + propNames.join(", ") + ")") : "");
        } else {
            msg = "Analyzed " + (differentPropsCount > 1 ? (differentPropsCount + " properties (" + propNames.join(", ") + ")") : propNames[0]);
        }

        return JSON.stringify({
            success: true,
            curve: firstCurve,
            hasMixedCurves: hasMixedCurves,
            differentPropsCount: differentPropsCount,
            propNames: propNames,
            hasDifferentProperties: hasDifferentProperties,
            totalKeysCount: totalKeysCount,
            totalSegments: totalSegments,
            message: msg
        });
    }

    /**
     * Fast selection fingerprint check: Detects if keyframe selection has changed
     * without full curve re-calculation.
     */
    function getSelectionFingerprint() {
        var comp = app.project ? app.project.activeItem : null;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ hasKeys: false, fingerprint: "none" });
        }

        var props = getSelectedProperties(comp);
        if (!props || props.length === 0) {
            return JSON.stringify({ hasKeys: false, fingerprint: "none" });
        }

        var totalKeys = 0;
        var parts = [];

        for (var p = 0; p < props.length; p++) {
            var prop = props[p];
            var keys = prop.selectedKeys;
            if (keys && keys.length > 0) {
                totalKeys += keys.length;
                var propId = prop.parentProperty ? (prop.parentProperty.name + "_" + prop.name + "_" + prop.propertyIndex) : (prop.name + "_" + prop.propertyIndex);
                var keyIndices = [];
                for (var k = 0; k < keys.length; k++) {
                    keyIndices.push(keys[k]);
                }
                parts.push(propId + ":" + keyIndices.join(","));
            }
        }

        if (totalKeys === 0) {
            return JSON.stringify({ hasKeys: false, fingerprint: "none" });
        }

        var fingerprint = comp.id + "|" + parts.join(";");
        return JSON.stringify({
            hasKeys: true,
            totalKeys: totalKeys,
            fingerprint: fingerprint
        });
    }

    /**
     * Direct Separate & Apply API: Accepts raw numbers directly.
     */
    function separateAndApplyValues(x1, y1, x2, y2) {
        return executeSeparateAndApply({
            x1: Number(x1),
            y1: Number(y1),
            x2: Number(x2),
            y2: Number(y2)
        });
    }

    /**
     * Position Overshoot Fixer:
     * Separates dimensions on spatial Position properties,
     * remaps key times to the newly created X/Y properties,
     * and applies the curve - all within a single undo group.
     */
    function separateAndApply(payloadJson) {
        var payload;
        if (typeof payloadJson === "object" && payloadJson !== null) {
            payload = payloadJson;
        } else {
            try {
                payload = eval("(" + payloadJson + ")");
            } catch (e) {
                try {
                    payload = JSON.parse(payloadJson);
                } catch (e2) {
                    return JSON.stringify({ success: false, message: "Invalid JSON payload: " + e2.toString() });
                }
            }
        }

        var curve = (payload && payload.curve) ? payload.curve : payload;
        if (!curve) {
            return JSON.stringify({ success: false, message: "No curve provided." });
        }

        return executeSeparateAndApply(curve);
    }

    function executeSeparateAndApply(curve) {
        var comp = app.project ? app.project.activeItem : null;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ success: false, message: "No active composition found." });
        }

        var props = getSelectedProperties(comp);
        if (props.length === 0) {
            return JSON.stringify({ success: false, message: "No properties selected." });
        }

        app.beginUndoGroup("HaymGraph Separate Dimensions & Apply");

        var separatedCount = 0;
        var appliedKeysCount = 0;
        var warnings = [];

        try {
            for (var p = 0; p < props.length; p++) {
                var prop = props[p];
                if (!isSpatialNonSeparatedPosition(prop)) {
                    // Regular property: apply directly
                    var selKeys = prop.selectedKeys;
                    if (selKeys && selKeys.length > 0) {
                        var regSorted = [];
                        for (var rk = 0; rk < selKeys.length; rk++) regSorted.push(selKeys[rk]);
                        regSorted.sort(function (a, b) { return a - b; });
                        var regSegments = getPropertySegments(prop, regSorted);
                        for (var rsi = 0; rsi < regSegments.length; rsi++) {
                            applyCurveToSegment(prop, regSegments[rsi][0], regSegments[rsi][1], curve);
                            appliedKeysCount++;
                        }
                    }
                    continue;
                }

                var layer = prop.propertyGroup(prop.propertyDepth);

                // Check edge cases: active expression & spatial curved tangents
                try {
                    if (prop.expressionEnabled && prop.expression && prop.expression.length > 0) {
                        warnings.push("Layer '" + layer.name + "': Position had an active expression. Review separated dimensions.");
                    }
                } catch (e) { }

                var selIndices = prop.selectedKeys;
                if (!selIndices || selIndices.length === 0) continue;

                try {
                    for (var sk = 0; sk < selIndices.length; sk++) {
                        var kTest = selIndices[sk];
                        var inTan = prop.keyInSpatialTangent(kTest);
                        var outTan = prop.keyOutSpatialTangent(kTest);
                        if ((inTan && (Math.abs(inTan[0]) > 0.1 || Math.abs(inTan[1]) > 0.1)) ||
                            (outTan && (Math.abs(outTan[0]) > 0.1 || Math.abs(outTan[1]) > 0.1))) {
                            warnings.push("Layer '" + layer.name + "': Curved motion path was linearized by separating dimensions.");
                            break;
                        }
                    }
                } catch (e) { }

                // 1. Record key times of the original position
                var origKeyTimes = [];
                for (var k = 0; k < selIndices.length; k++) {
                    origKeyTimes.push(prop.keyTime(selIndices[k]));
                }

                // 2. Separate dimensions
                prop.dimensionsSeparated = true;
                separatedCount++;

                // 3. Locate new separated properties (X Position, Y Position, Z Position)
                var transformGroup = layer.property("ADBE Transform Group");
                if (!transformGroup) continue;

                var xProp = transformGroup.property("ADBE Position_0");
                var yProp = transformGroup.property("ADBE Position_1");
                var zProp = layer.threeDLayer ? transformGroup.property("ADBE Position_2") : null;

                var separatedProps = [xProp, yProp];
                if (zProp) separatedProps.push(zProp);

                // 4. Map original key times to the new properties and apply curve
                for (var sp = 0; sp < separatedProps.length; sp++) {
                    var sProp = separatedProps[sp];
                    if (!sProp || !sProp.canVaryOverTime) continue;

                    for (var t = 0; t < origKeyTimes.length - 1; t++) {
                        var time1 = origKeyTimes[t];
                        var time2 = origKeyTimes[t + 1];

                        var kIdx1 = sProp.nearestKeyIndex(time1);
                        var kIdx2 = sProp.nearestKeyIndex(time2);

                        if (kIdx1 > 0 && kIdx2 > 0 && kIdx1 !== kIdx2) {
                            applyCurveToSegment(sProp, kIdx1, kIdx2, curve);
                            appliedKeysCount++;
                        }
                    }
                }
            }
        } catch (err) {
            app.endUndoGroup();
            return JSON.stringify({
                success: false,
                message: "Error during separation & apply: " + err.toString()
            });
        }

        app.endUndoGroup();

        return JSON.stringify({
            success: true,
            separatedCount: separatedCount,
            keysCount: appliedKeysCount,
            message: "Separated " + separatedCount + " Position dimension(s) and applied curve to " + appliedKeysCount + " segment(s).",
            warnings: warnings
        });
    }

    /**
     * Helper to analyze selected layers in composition:
     * Returns the topmost selected layer (lowest index in timeline), the earliest inPoint,
     * the latest outPoint, and whether any layer is 3D.
     */
    function getSelectedLayersBounds(comp) {
        var sel = comp.selectedLayers;
        if (!sel || sel.length === 0) {
            return {
                hasSelection: false,
                topLayer: null,
                minIn: (comp.workAreaDuration > 0 && comp.workAreaDuration < comp.duration) ? comp.workAreaStart : 0,
                maxOut: (comp.workAreaDuration > 0 && comp.workAreaDuration < comp.duration) ? (comp.workAreaStart + comp.workAreaDuration) : comp.duration,
                isAny3D: false,
                layers: []
            };
        }

        var topLayer = sel[0];
        var minIn = sel[0].inPoint;
        var maxOut = sel[0].outPoint;
        var isAny3D = false;
        var layerList = [];

        for (var i = 0; i < sel.length; i++) {
            var l = sel[i];
            layerList.push(l);
            if (l.index < topLayer.index) {
                topLayer = l;
            }
            if (l.inPoint < minIn) minIn = l.inPoint;
            if (l.outPoint > maxOut) maxOut = l.outPoint;
            if (l.threeDLayer) isAny3D = true;
        }

        return {
            hasSelection: true,
            topLayer: topLayer,
            minIn: minIn,
            maxOut: maxOut,
            isAny3D: isAny3D,
            layers: layerList
        };
    }

    /**
     * Moves newly created layer directly above the topmost selected layer
     * and autotrims to earliest start and latest end of selected layers.
     */
    function applyBoundsAndPlacement(comp, newLayer, bounds) {
        if (bounds.hasSelection && bounds.topLayer) {
            try {
                newLayer.moveBefore(bounds.topLayer);
            } catch (e1) {}

            if (bounds.minIn < bounds.maxOut) {
                try {
                    newLayer.startTime = bounds.minIn;
                    newLayer.inPoint = bounds.minIn;
                    newLayer.outPoint = bounds.maxOut;
                } catch (e2) {}
            }
        } else {
            if (comp.workAreaDuration > 0 && comp.workAreaDuration < comp.duration) {
                try {
                    newLayer.startTime = comp.workAreaStart;
                    newLayer.inPoint = comp.workAreaStart;
                    newLayer.outPoint = comp.workAreaStart + comp.workAreaDuration;
                } catch (e3) {}
            }
        }
    }

    /**
     * Add an Adjustment Layer to the active composition.
     * Placed right above the topmost selected layer (or at top of comp).
     * Autotrimmed to most starting and most ending selected layer point.
     */
    function addAdjustmentLayer() {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ success: false, error: "No active composition." });
        }

        app.beginUndoGroup("Add Adjustment Layer");
        try {
            // 1. Capture selection bounds BEFORE adding solid
            var bounds = getSelectedLayersBounds(comp);

            // 2. Add solid
            var adj = comp.layers.addSolid([1, 1, 1], "Adjustment Layer", comp.width, comp.height, comp.pixelAspect, comp.duration);
            adj.adjustmentLayer = true;
            adj.label = 5; // Standard AE adjustment layer color

            // 3. Move directly above topmost selected layer & autotrim
            applyBoundsAndPlacement(comp, adj, bounds);

            // 4. Deselect previous, select adjustment layer
            for (var j = 0; j < comp.numLayers; j++) {
                comp.layer(j + 1).selected = false;
            }
            adj.selected = true;

            app.endUndoGroup();
            return JSON.stringify({ success: true, name: adj.name });
        } catch (e) {
            app.endUndoGroup();
            return JSON.stringify({ success: false, error: e.toString() });
        }
    }

    /**
     * Helper to compute a layer's visual center point in composition/world coordinates.
     */
    function getLayerCenterCoord(layer, time) {
        var rect = null;
        try {
            rect = layer.sourceRectAtTime(time, false);
        } catch (e1) { }

        var localCenter;
        if (rect && (rect.width > 0 || rect.height > 0)) {
            localCenter = [rect.left + rect.width / 2, rect.top + rect.height / 2];
        } else {
            try {
                localCenter = layer.transform.anchorPoint.valueAtTime(time, false);
            } catch (e2) {
                localCenter = [0, 0];
            }
        }

        try {
            if (layer.threeDLayer) {
                var z = (localCenter.length > 2 ? localCenter[2] : 0);
                return layer.toWorld([localCenter[0], localCenter[1], z], time);
            } else {
                return layer.toComp([localCenter[0], localCenter[1]], time);
            }
        } catch (e3) {
            try {
                return layer.transform.position.valueAtTime(time, false);
            } catch (e4) {
                return [0, 0, 0];
            }
        }
    }

    /**
     * Add a Null object, placed at the calculated mathematical center of selected layer(s),
     * auto-parenting selected layers to the Null, placed right on top of topmost selected layer,
     * and autotrimmed to the earliest starting and latest ending point.
     */
    function addCenterNull() {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ success: false, error: "No active composition." });
        }

        app.beginUndoGroup("Add Parented Center Null");
        try {
            // 1. Capture selection bounds BEFORE creating null
            var bounds = getSelectedLayersBounds(comp);
            var time = comp.time;
            var nullLayer = comp.layers.addNull();

            if (!bounds.hasSelection) {
                nullLayer.name = "Null 1";
                nullLayer.transform.position.setValue([comp.width / 2, comp.height / 2]);
                applyBoundsAndPlacement(comp, nullLayer, bounds);
            } else {
                var centers = [];
                for (var i = 0; i < bounds.layers.length; i++) {
                    var l = bounds.layers[i];
                    var centerPt = getLayerCenterCoord(l, time);
                    centers.push(centerPt);
                }

                // Math: Calculate overall group center
                var finalCenter;
                if (centers.length === 1) {
                    finalCenter = centers[0];
                } else {
                    var minX = centers[0][0], maxX = centers[0][0];
                    var minY = centers[0][1], maxY = centers[0][1];
                    var minZ = (centers[0].length > 2 ? centers[0][2] : 0);
                    var maxZ = minZ;

                    for (var c = 1; c < centers.length; c++) {
                        var p = centers[c];
                        if (p[0] < minX) minX = p[0];
                        if (p[0] > maxX) maxX = p[0];
                        if (p[1] < minY) minY = p[1];
                        if (p[1] > maxY) maxY = p[1];
                        var pz = (p.length > 2 ? p[2] : 0);
                        if (pz < minZ) minZ = pz;
                        if (pz > maxZ) maxZ = pz;
                    }
                    finalCenter = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
                }

                if (bounds.isAny3D) {
                    nullLayer.threeDLayer = true;
                    var zCoord = (finalCenter.length > 2 ? finalCenter[2] : 0);
                    nullLayer.transform.position.setValue([finalCenter[0], finalCenter[1], zCoord]);
                } else {
                    nullLayer.transform.position.setValue([finalCenter[0], finalCenter[1]]);
                }

                if (bounds.layers.length === 1) {
                    nullLayer.name = bounds.layers[0].name + " Null";
                } else {
                    nullLayer.name = "Controller Null";
                }

                // Move right above topmost selected layer & autotrim
                applyBoundsAndPlacement(comp, nullLayer, bounds);

                // Inherit existing parent if single layer had one
                if (bounds.layers.length === 1 && bounds.layers[0].parent) {
                    nullLayer.parent = bounds.layers[0].parent;
                }

                // Auto-parent selected layers to this null
                for (var k = 0; k < bounds.layers.length; k++) {
                    var child = bounds.layers[k];
                    // Skip if child's parent is also in the selection
                    var parentInSel = false;
                    if (child.parent) {
                        for (var pIdx = 0; pIdx < bounds.layers.length; pIdx++) {
                            if (child.parent === bounds.layers[pIdx]) {
                                parentInSel = true;
                                break;
                            }
                        }
                    }
                    if (!parentInSel) {
                        child.parent = nullLayer;
                    }
                }
            }

            // Select the new null
            for (var m = 0; m < comp.numLayers; m++) {
                comp.layer(m + 1).selected = false;
            }
            nullLayer.selected = true;

            app.endUndoGroup();
            return JSON.stringify({ success: true, name: nullLayer.name });
        } catch (err) {
            app.endUndoGroup();
            return JSON.stringify({ success: false, error: err.toString() });
        }
    }

    /**
     * Add a Solid Layer (Black, White, or custom color).
     * Placed right above topmost selected layer, auto-trimmed to minIn & maxOut.
     */
    function addSolidLayer(colorR, colorG, colorB, customName) {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ success: false, error: "No active composition." });
        }

        app.beginUndoGroup("Add Solid Layer");
        try {
            var bounds = getSelectedLayersBounds(comp);
            var r = (typeof colorR === "number") ? colorR : 1;
            var g = (typeof colorG === "number") ? colorG : 1;
            var b = (typeof colorB === "number") ? colorB : 1;
            var solidName = customName || ((r === 1 && g === 1 && b === 1) ? "White Solid" : ((r === 0 && g === 0 && b === 0) ? "Black Solid" : "Solid Layer"));

            var solid = comp.layers.addSolid([r, g, b], solidName, comp.width, comp.height, comp.pixelAspect, comp.duration);
            applyBoundsAndPlacement(comp, solid, bounds);

            for (var j = 0; j < comp.numLayers; j++) {
                comp.layer(j + 1).selected = false;
            }
            solid.selected = true;

            app.endUndoGroup();
            return JSON.stringify({ success: true, name: solid.name });
        } catch (e) {
            app.endUndoGroup();
            return JSON.stringify({ success: false, error: e.toString() });
        }
    }

    /**
     * Center Anchor Point for all selected layers using sourceRect bounding math,
     * compensating layer position so the layer does NOT jump on screen.
     */
    function centerAnchorPoint() {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ success: false, error: "No active composition." });
        }
        var layers = comp.selectedLayers;
        if (!layers || layers.length === 0) {
            return JSON.stringify({ success: false, error: "No layers selected to center anchor point." });
        }

        app.beginUndoGroup("Center Anchor Point");
        var modified = 0;
        try {
            var time = comp.time;
            for (var i = 0; i < layers.length; i++) {
                var layer = layers[i];
                if (layer.locked) continue;

                var rect = null;
                try {
                    rect = layer.sourceRectAtTime(time, false);
                } catch (e1) { }

                if (!rect || (rect.width === 0 && rect.height === 0)) continue;

                var curAnchor = layer.transform.anchorPoint.value;
                var newAnchor = [rect.left + rect.width / 2, rect.top + rect.height / 2];
                var deltaX = newAnchor[0] - curAnchor[0];
                var deltaY = newAnchor[1] - curAnchor[1];

                if (Math.abs(deltaX) < 0.001 && Math.abs(deltaY) < 0.001) {
                    modified++;
                    continue;
                }

                // Math compensation to prevent layer from jumping in comp space:
                var newCompPos;
                if (layer.threeDLayer) {
                    var anchor3D = [newAnchor[0], newAnchor[1], curAnchor.length > 2 ? curAnchor[2] : 0];
                    newCompPos = layer.toWorld(anchor3D, time);
                    if (layer.parent) {
                        newCompPos = layer.parent.fromWorld(newCompPos, time);
                    }
                    layer.transform.anchorPoint.setValue(anchor3D);

                    if (layer.transform.position.dimensionsSeparated) {
                        var tg = layer.property("ADBE Transform Group");
                        if (tg) {
                            var p0 = tg.property("ADBE Position_0");
                            var p1 = tg.property("ADBE Position_1");
                            var p2 = tg.property("ADBE Position_2");
                            if (p0) p0.setValue(newCompPos[0]);
                            if (p1) p1.setValue(newCompPos[1]);
                            if (p2 && newCompPos.length > 2) p2.setValue(newCompPos[2]);
                        }
                    } else {
                        layer.transform.position.setValue(newCompPos);
                    }
                } else {
                    newCompPos = layer.toComp(newAnchor, time);
                    if (layer.parent) {
                        newCompPos = layer.parent.fromComp(newCompPos, time);
                    }
                    layer.transform.anchorPoint.setValue(newAnchor);

                    if (layer.transform.position.dimensionsSeparated) {
                        var tg2 = layer.property("ADBE Transform Group");
                        if (tg2) {
                            var px0 = tg2.property("ADBE Position_0");
                            var px1 = tg2.property("ADBE Position_1");
                            if (px0) px0.setValue(newCompPos[0]);
                            if (px1) px1.setValue(newCompPos[1]);
                        }
                    } else {
                        layer.transform.position.setValue([newCompPos[0], newCompPos[1]]);
                    }
                }
                modified++;
            }

            app.endUndoGroup();
            return JSON.stringify({ success: true, count: modified });
        } catch (e) {
            app.endUndoGroup();
            return JSON.stringify({ success: false, error: e.toString() });
        }
    }

    /**
     * Toggle loopOut expression on selected properties.
     * Cycles: loopOut("cycle") -> loopOut("pingpong") -> None
     */
    function toggleLoopKeyframes() {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ success: false, error: "No active composition." });
        }
        var props = comp.selectedProperties;
        if (!props || props.length === 0) {
            return JSON.stringify({ success: false, error: "No properties selected." });
        }

        app.beginUndoGroup("Toggle loopOut Expression");
        var count = 0;
        try {
            for (var i = 0; i < props.length; i++) {
                var p = props[i];
                if (p.canSetExpression && p.numKeys > 1) {
                    var expr = p.expression || "";
                    if (expr.indexOf("loopOut") === -1) {
                        p.expression = 'loopOut("cycle");';
                        p.expressionEnabled = true;
                        count++;
                    } else if (expr.indexOf('"cycle"') !== -1) {
                        p.expression = 'loopOut("pingpong");';
                        p.expressionEnabled = true;
                        count++;
                    } else {
                        p.expression = "";
                        p.expressionEnabled = false;
                        count++;
                    }
                }
            }
            app.endUndoGroup();
            return JSON.stringify({ success: true, count: count });
        } catch (e) {
            app.endUndoGroup();
            return JSON.stringify({ success: false, error: e.toString() });
        }
    }

    /**
     * Add a 3D Camera Rig: a 35mm camera parented to a 3D Controller Null.
     * Placed right on top of topmost selected layer, auto-trimmed to selection bounds.
     */
    function addCameraRig() {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ success: false, error: "No active composition." });
        }

        app.beginUndoGroup("Add 3D Camera Rig");
        try {
            var bounds = getSelectedLayersBounds(comp);
            var cam = comp.layers.addCamera("Camera 1", [comp.width / 2, comp.height / 2]);
            var ctrlNull = comp.layers.addNull();
            ctrlNull.name = "Camera Controller";
            ctrlNull.threeDLayer = true;
            ctrlNull.transform.position.setValue([comp.width / 2, comp.height / 2, 0]);
            cam.parent = ctrlNull;

            applyBoundsAndPlacement(comp, cam, bounds);
            ctrlNull.moveBefore(cam);
            if (bounds.minIn < bounds.maxOut) {
                ctrlNull.startTime = bounds.minIn;
                ctrlNull.inPoint = bounds.minIn;
                ctrlNull.outPoint = bounds.maxOut;
            }

            for (var j = 0; j < comp.numLayers; j++) {
                comp.layer(j + 1).selected = false;
            }
            ctrlNull.selected = true;

            app.endUndoGroup();
            return JSON.stringify({ success: true });
        } catch (e) {
            app.endUndoGroup();
            return JSON.stringify({ success: false, error: e.toString() });
        }
    }

    /**
     * Smart Precompose: Precompose selected layers trimmed to selection bounds.
     */
    function smartPrecompose() {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ success: false, error: "No active composition." });
        }
        var bounds = getSelectedLayersBounds(comp);
        if (!bounds.hasSelection) {
            return JSON.stringify({ success: false, error: "No layers selected to precompose." });
        }

        app.beginUndoGroup("Pre-compose Selection");
        try {
            var indices = [];
            for (var i = 0; i < bounds.layers.length; i++) {
                indices.push(bounds.layers[i].index);
            }
            var name = bounds.layers[0].name + " Comp";
            var precomp = comp.layers.precompose(indices, name, true);
            if (bounds.minIn < bounds.maxOut) {
                precomp.startTime = bounds.minIn;
                precomp.inPoint = bounds.minIn;
                precomp.outPoint = bounds.maxOut;
            }
            app.endUndoGroup();
            return JSON.stringify({ success: true, name: precomp.name });
        } catch (e) {
            app.endUndoGroup();
            return JSON.stringify({ success: false, error: e.toString() });
        }
    }

    /**
     * Split selected layer(s) at current playhead time (Ctrl+Shift+D).
     */
    function splitLayersAtPlayhead() {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ success: false, error: "No active composition." });
        }
        var sel = comp.selectedLayers;
        if (!sel || sel.length === 0) {
            return JSON.stringify({ success: false, error: "No layers selected to split." });
        }

        app.beginUndoGroup("Split Layer at Current Time");
        var time = comp.time;
        var splitCount = 0;
        try {
            for (var i = 0; i < sel.length; i++) {
                var layer = sel[i];
                if (time > layer.inPoint && time < layer.outPoint) {
                    var dup = layer.duplicate();
                    layer.outPoint = time;
                    dup.inPoint = time;
                    dup.moveAfter(layer);
                    splitCount++;
                }
            }
            app.endUndoGroup();
            return JSON.stringify({ success: true, count: splitCount });
        } catch (e) {
            app.endUndoGroup();
            return JSON.stringify({ success: false, error: e.toString() });
        }
    }

    return {
        checkSelectionStatus: checkSelectionStatus,
        getSelectionFingerprint: getSelectionFingerprint,
        applyBezier: applyBezier,
        applyBezierValues: applyBezierValues,
        analyzeSelection: analyzeSelection,
        separateAndApply: separateAndApply,
        separateAndApplyValues: separateAndApplyValues,
        addAdjustmentLayer: addAdjustmentLayer,
        addCenterNull: addCenterNull,
        centerAnchorPoint: centerAnchorPoint,
        toggleLoopKeyframes: toggleLoopKeyframes,
        addCameraRig: addCameraRig,
        smartPrecompose: smartPrecompose,
        addSolidLayer: addSolidLayer,
        splitLayersAtPlayhead: splitLayersAtPlayhead
    };
})();
