/**
 * HaymGraph - Main Application Controller
 * Handles UI interactions, CEP host communication,
 * Position Overshoot Fixer workflows, and theme synchronization.
 */

(function () {
    'use strict';

    var csInterface = new CSInterface();
    var curveBox = null;
    var currentExtrema = { minY: 0, maxY: 1, hasOvershoot: false };
    var hasSpatialNonSeparatedPosition = false;

    // DOM Elements
    var overshootBadge = document.getElementById('overshoot-badge');
    var badgeExtrema = document.getElementById('badge-extrema');
    var readoutP1Coords = document.getElementById('readout-p1-coords');
    var readoutP2Coords = document.getElementById('readout-p2-coords');
    var readoutInf1 = document.getElementById('readout-inf1');
    var readoutSlope1 = document.getElementById('readout-slope1');
    var readoutInf2 = document.getElementById('readout-inf2');
    var readoutSlope2 = document.getElementById('readout-slope2');
    var statusMsg = document.getElementById('status-msg');
    var statusDot = document.getElementById('status-dot');
    var mixedIndicator = document.getElementById('mixed-indicator');

    var btnApply = document.getElementById('btn-apply');
    var btnAnalyze = document.getElementById('btn-analyze');
    var btnReverse = document.getElementById('btn-reverse');
    var btnFlatten = document.getElementById('btn-flatten');
    var btnEase = document.getElementById('btn-ease');
    var btnLinear = document.getElementById('btn-linear');

    // Modal elements
    var overshootModal = document.getElementById('overshoot-modal');
    var modalOvershootRange = document.getElementById('modal-overshoot-range');
    var btnSeparateApply = document.getElementById('btn-separate-apply');
    var btnApplyClamped = document.getElementById('btn-apply-clamped');
    var btnModalClose = document.getElementById('btn-modal-close');
    var toastContainer = document.getElementById('toast-container');

    function init() {
        // 1. Initialize CurveBox
        curveBox = new CurveBox('#curve-box-container', {
            onCurveChange: handleCurveChange
        });

        // 2. Register key interest for Enter key in CEP
        // Key code 13 is Enter
        try {
            var keyEventsInterest = JSON.stringify([
                { keyCode: 13 }
            ]);
            csInterface.registerKeyEventsInterest(keyEventsInterest);
        } catch (e) {}

        // 3. Bind UI buttons
        btnApply.addEventListener('click', onApplyClick);
        btnAnalyze.addEventListener('click', onAnalyzeClick);
        btnReverse.addEventListener('click', function () {
            curveBox.reverseCurve();
            showToast("Curve reversed", "info");
        });
        btnFlatten.addEventListener('click', function () {
            curveBox.flattenHandle(1);
            curveBox.flattenHandle(2);
            showToast("Tangents flattened (Speed = 0)", "info");
        });
        btnEase.addEventListener('click', function () {
            curveBox.setCurve({ x1: 0.333, y1: 0.0, x2: 0.667, y2: 1.0 });
            showToast("Set Standard Ease", "info");
        });
        btnLinear.addEventListener('click', function () {
            curveBox.setCurve({ x1: 0.333, y1: 0.333, x2: 0.667, y2: 0.667 });
            showToast("Set Linear", "info");
        });

        // 4. Modal actions
        overshootBadge.addEventListener('click', function () {
            openOvershootModal();
        });
        btnSeparateApply.addEventListener('click', onSeparateAndApply);
        btnApplyClamped.addEventListener('click', function () {
            closeOvershootModal();
            executeApplyCurve();
        });
        btnModalClose.addEventListener('click', closeOvershootModal);

        // 5. Global Keyboard shortcuts
        window.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                onApplyClick();
            } else if (e.key === 'Escape') {
                closeOvershootModal();
            }
        });

        // 6. Host Theme synchronization
        syncTheme();
        csInterface.addEventListener(CSInterface.THEME_COLOR_CHANGED_EVENT, syncTheme);

        // 7. Initial selection check
        refreshSelectionStatus();

        // 8. Trigger initial curve update
        handleCurveChange(curveBox.curve, HaymMath.computeCurveExtrema(curveBox.curve), null);
    }

    /**
     * Curve change handler - updates readouts, extrema, and overshoot badge.
     */
    function handleCurveChange(curve, extrema, handleIndex) {
        currentExtrema = extrema;

        // Update coordinate readouts
        readoutP1Coords.textContent = curve.x1.toFixed(2) + ", " + curve.y1.toFixed(2);
        readoutP2Coords.textContent = curve.x2.toFixed(2) + ", " + curve.y2.toFixed(2);

        // Update influence & slope
        var inf1 = (curve.x1 * 100).toFixed(1);
        var slope1 = (curve.y1 / Math.max(curve.x1, 0.0001)).toFixed(2);
        var inf2 = ((1.0 - curve.x2) * 100).toFixed(1);
        var slope2 = ((1.0 - curve.y2) / Math.max(1.0 - curve.x2, 0.0001)).toFixed(2);

        readoutInf1.textContent = inf1;
        readoutSlope1.textContent = slope1;
        readoutInf2.textContent = inf2;
        readoutSlope2.textContent = slope2;

        // Viewport extrema badge
        badgeExtrema.textContent = "Y: [" + extrema.minY.toFixed(2) + ", " + extrema.maxY.toFixed(2) + "]";
        if (extrema.hasOvershoot) {
            badgeExtrema.classList.add('overshoot');
        } else {
            badgeExtrema.classList.remove('overshoot');
        }

        updateOvershootUI();
    }

    /**
     * Polls/refreshes AE selection status.
     */
    function refreshSelectionStatus(callback) {
        csInterface.evalScript("HaymHost.checkSelectionStatus()", function (resStr) {
            try {
                var res = JSON.parse(resStr);
                hasSpatialNonSeparatedPosition = !!res.hasSpatialPosition;
                updateOvershootUI();
                if (callback) callback(res);
            } catch (e) {
                if (callback) callback(null);
            }
        });
    }

    /**
     * Updates visibility of the 🔒 Locked badge.
     */
    function updateOvershootUI() {
        if (currentExtrema.hasOvershoot && hasSpatialNonSeparatedPosition) {
            overshootBadge.classList.remove('hidden');
        } else {
            overshootBadge.classList.add('hidden');
        }
    }

    /**
     * Apply Button click handler.
     */
    function onApplyClick() {
        refreshSelectionStatus(function (status) {
            if (currentExtrema.hasOvershoot && hasSpatialNonSeparatedPosition) {
                openOvershootModal();
            } else {
                executeApplyCurve();
            }
        });
    }

    /**
     * Executes standard apply curve to host.
     */
    function executeApplyCurve() {
        setStatus("Applying curve...", false);
        var payload = JSON.stringify({ curve: curveBox.curve });

        csInterface.evalScript("HaymHost.applyBezier('" + payload + "')", function (resStr) {
            try {
                var res = JSON.parse(resStr);
                if (res.success) {
                    setStatus(res.message, true);
                    showToast(res.message, "success");
                } else {
                    setStatus(res.message || "Failed to apply", false);
                    showToast(res.message, "warning");
                }
            } catch (err) {
                setStatus("Communication error: " + err.toString(), false);
                showToast("Host error: " + err.toString(), "error");
            }
        });
    }

    /**
     * Position Overshoot Fixer: Separate dimensions and apply.
     */
    function onSeparateAndApply() {
        closeOvershootModal();
        setStatus("Separating dimensions & applying...", false);

        var payload = JSON.stringify({ curve: curveBox.curve });
        csInterface.evalScript("HaymHost.separateAndApply('" + payload + "')", function (resStr) {
            try {
                var res = JSON.parse(resStr);
                if (res.success) {
                    setStatus(res.message, true);
                    showToast(res.message, "success");
                    hasSpatialNonSeparatedPosition = false;
                    updateOvershootUI();
                } else {
                    setStatus(res.message || "Failed to separate", false);
                    showToast(res.message, "warning");
                }
            } catch (e) {
                setStatus("Error: " + e.toString(), false);
                showToast(e.toString(), "error");
            }
        });
    }

    /**
     * Analyze selected keyframes in AE.
     */
    function onAnalyzeClick() {
        setStatus("Analyzing selection...", false);
        csInterface.evalScript("HaymHost.analyzeSelection()", function (resStr) {
            try {
                var res = JSON.parse(resStr);
                if (res.success && res.curve) {
                    curveBox.setCurve(res.curve);
                    setStatus(res.message, true);
                    showToast(res.message, "success");

                    if (res.hasMixedCurves) {
                        mixedIndicator.style.display = 'block';
                    } else {
                        mixedIndicator.style.display = 'none';
                    }
                } else {
                    setStatus(res.message || "Could not analyze", false);
                    showToast(res.message, "warning");
                }
            } catch (err) {
                setStatus("Analyze error: " + err.toString(), false);
                showToast(err.toString(), "error");
            }
        });
    }

    function openOvershootModal() {
        modalOvershootRange.textContent = "min: " + currentExtrema.minY.toFixed(2) + ", max: " + currentExtrema.maxY.toFixed(2);
        overshootModal.classList.add('open');
    }

    function closeOvershootModal() {
        overshootModal.classList.remove('open');
    }

    function setStatus(text, isActive) {
        statusMsg.textContent = text;
        if (isActive) {
            statusDot.className = 'status-dot active';
        } else {
            statusDot.className = 'status-dot';
        }
    }

    function showToast(message, type) {
        var toast = document.createElement('div');
        toast.className = 'toast ' + (type || 'info');
        toast.textContent = message;
        toastContainer.appendChild(toast);

        setTimeout(function () {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.25s ease';
            setTimeout(function () {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 260);
        }, 2400);
    }

    function syncTheme() {
        try {
            var hostEnv = csInterface.getHostEnvironment();
            if (hostEnv && hostEnv.appSkinInfo) {
                var skin = hostEnv.appSkinInfo;
                var panelBg = skin.panelBackgroundColor;
                if (panelBg && panelBg.color) {
                    var r = Math.round(panelBg.color.red);
                    var g = Math.round(panelBg.color.green);
                    var b = Math.round(panelBg.color.blue);
                    document.documentElement.style.setProperty('--bg-primary', "rgb(" + r + "," + g + "," + b + ")");
                    // Generate subtle variations
                    document.documentElement.style.setProperty('--bg-secondary', "rgb(" + Math.min(255, r + 6) + "," + Math.min(255, g + 6) + "," + Math.min(255, b + 6) + ")");
                    document.documentElement.style.setProperty('--bg-tertiary', "rgb(" + Math.min(255, r + 14) + "," + Math.min(255, g + 14) + "," + Math.min(255, b + 14) + ")");
                }
            }
        } catch (e) {}
    }

    // Initialize once DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
