/**
 * HaymGraph - Main Application Controller
 * Handles UI interactions, CEP host communication,
 * Position Overshoot Fixer workflows, settings, and auto-updates.
 */

(function () {
    'use strict';

    var csInterface = new CSInterface();
    var curveBox = null;
    var currentExtrema = { minY: 0, maxY: 1, hasOvershoot: false };
    var hasSpatialNonSeparatedPosition = false;
    var latestReleaseUrl = null;

    // Header & Toolbar DOM Elements
    var overshootBadge = document.getElementById('overshoot-badge');
    var badgeExtrema = document.getElementById('badge-extrema');
    var btnSettings = document.getElementById('btn-settings');
    var updateDot = document.getElementById('update-dot');
    var statusMsg = document.getElementById('status-msg');
    var statusDot = document.getElementById('status-dot');
    var mixedIndicator = document.getElementById('mixed-indicator');

    var btnApply = document.getElementById('btn-apply');
    var btnAnalyze = document.getElementById('btn-analyze');
    var btnReverse = document.getElementById('btn-reverse');

    // Position Overshoot Modal Elements
    var overshootModal = document.getElementById('overshoot-modal');
    var modalOvershootRange = document.getElementById('modal-overshoot-range');
    var btnSeparateApply = document.getElementById('btn-separate-apply');
    var btnApplyClamped = document.getElementById('btn-apply-clamped');
    var btnModalClose = document.getElementById('btn-modal-close');

    // Settings & Updates Modal Elements
    var settingsModal = document.getElementById('settings-modal');
    var settingVersionTag = document.getElementById('setting-version-tag');
    var settingAutocheckToggle = document.getElementById('setting-autocheck-toggle');
    var updateStatusBox = document.getElementById('update-status-box');
    var btnCheckUpdates = document.getElementById('btn-check-updates');
    var btnInstallUpdate = document.getElementById('btn-install-update');
    var btnSettingsClose = document.getElementById('btn-settings-close');
    var currentUpdateTag = null;

    function init() {
        // 1. Initialize CurveBox
        curveBox = new CurveBox('#curve-box-container', {
            onCurveChange: handleCurveChange
        });

        // 2. Register key interest for Enter key in CEP
        try {
            var keyEventsInterest = JSON.stringify([
                { keyCode: 13 }
            ]);
            csInterface.registerKeyEventsInterest(keyEventsInterest);
        } catch (e) {}

        // 3. Bind Action Buttons
        btnApply.addEventListener('click', onApplyClick);
        btnAnalyze.addEventListener('click', onAnalyzeClick);
        btnReverse.addEventListener('click', function () {
            curveBox.reverseCurve();
            setStatus("Curve reversed", false);
        });

        // 4. Position Overshoot Modal Actions
        overshootBadge.addEventListener('click', openOvershootModal);
        btnSeparateApply.addEventListener('click', onSeparateAndApply);
        btnApplyClamped.addEventListener('click', function () {
            closeOvershootModal();
            executeApplyCurve();
        });
        btnModalClose.addEventListener('click', closeOvershootModal);

        // 5. Settings & Auto-Updater Actions
        btnSettings.addEventListener('click', openSettingsModal);
        btnSettingsClose.addEventListener('click', closeSettingsModal);
        btnCheckUpdates.addEventListener('click', triggerManualUpdateCheck);
        btnInstallUpdate.addEventListener('click', function () {
            startAutoUpdate(currentUpdateTag, "latest");
        });

        if (settingAutocheckToggle) {
            settingAutocheckToggle.checked = HaymUpdater.isAutoCheckEnabled();
            settingAutocheckToggle.addEventListener('change', function () {
                HaymUpdater.setAutoCheckEnabled(settingAutocheckToggle.checked);
            });
        }

        if (settingVersionTag) {
            settingVersionTag.textContent = "v" + HaymUpdater.CURRENT_VERSION;
        }

        // 6. Global Keyboard Shortcuts
        window.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                onApplyClick();
            } else if (e.key === 'Escape') {
                closeOvershootModal();
                closeSettingsModal();
            }
        });

        // 7. Host Theme synchronization
        syncTheme();
        csInterface.addEventListener(CSInterface.THEME_COLOR_CHANGED_EVENT, syncTheme);

        // 8. Initial selection check
        refreshSelectionStatus();

        // 9. Initial curve update
        handleCurveChange(curveBox.curve, HaymMath.computeCurveExtrema(curveBox.curve), null);

        // 10. Background Update Check (if enabled)
        if (HaymUpdater.isAutoCheckEnabled()) {
            setTimeout(checkUpdatesSilently, 2500);
        }
    }

    /**
     * Curve change handler - updates extrema badge & overshoot UI.
     */
    function handleCurveChange(curve, extrema, handleIndex) {
        currentExtrema = extrema;

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
                } else {
                    setStatus(res.message || "Failed to apply", false);
                }
            } catch (err) {
                setStatus("Communication error: " + err.toString(), false);
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
                    hasSpatialNonSeparatedPosition = false;
                    updateOvershootUI();
                } else {
                    setStatus(res.message || "Failed to separate", false);
                }
            } catch (e) {
                setStatus("Error: " + e.toString(), false);
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

                    if (res.hasMixedCurves) {
                        mixedIndicator.style.display = 'block';
                    } else {
                        mixedIndicator.style.display = 'none';
                    }
                } else {
                    setStatus(res.message || "Could not analyze", false);
                }
            } catch (err) {
                setStatus("Analyze error: " + err.toString(), false);
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

    function openSettingsModal() {
        settingsModal.classList.add('open');
    }

    function closeSettingsModal() {
        settingsModal.classList.remove('open');
    }

    function setStatus(text, isActive) {
        statusMsg.textContent = text;
        if (isActive) {
            statusDot.className = 'status-dot active';
        } else {
            statusDot.className = 'status-dot';
        }
    }

    var isUpdating = false;

    /**
     * Automatically downloads and installs the detected update in-place,
     * showing progress in the status bar and modal, then reloads the panel.
     */
    function startAutoUpdate(targetTag, targetVersion) {
        if (isUpdating) return;
        isUpdating = true;

        var extDir = "";
        try {
            if (csInterface && csInterface.getSystemPath && typeof SystemPath !== "undefined" && SystemPath.EXTENSION) {
                extDir = csInterface.getSystemPath(SystemPath.EXTENSION);
            }
        } catch (e) {}

        updateDot.classList.remove('hidden');
        setStatus("New version v" + targetVersion + " found! Auto-installing...", true);

        if (updateStatusBox) {
            updateStatusBox.className = "update-status-box has-update";
            updateStatusBox.textContent = "New version v" + targetVersion + " found! Auto-installing update...";
        }
        if (btnCheckUpdates) {
            btnCheckUpdates.disabled = true;
        }
        if (btnInstallUpdate) {
            btnInstallUpdate.classList.add('hidden');
        }

        HaymUpdater.installUpdateInPlace(targetTag, function (msg) {
            setStatus(msg, true);
            if (updateStatusBox) {
                updateStatusBox.textContent = msg;
            }
        }, function (result) {
            isUpdating = false;
            if (btnCheckUpdates) {
                btnCheckUpdates.disabled = false;
            }
            if (result.success) {
                try {
                    sessionStorage.removeItem("haym_auto_update_attempt");
                } catch (e) {}
                setStatus("Updated to v" + targetVersion + "! Reloading...", true);
                if (updateStatusBox) {
                    updateStatusBox.className = "update-status-box";
                    updateStatusBox.textContent = "Updated to v" + targetVersion + "! Reloading panel...";
                }
            } else {
                setStatus("Update stopped: " + (result.message || "Unknown error"), false);
                if (updateStatusBox) {
                    updateStatusBox.className = "update-status-box error";
                    updateStatusBox.textContent = result.message || "Auto-update failed.";
                }
            }
        }, extDir);
    }

    /**
     * Background quiet update check: checks GitHub and automatically installs if an update exists.
     * Guarded by session storage to prevent infinite download loops.
     */
    function checkUpdatesSilently() {
        if (isUpdating) return;

        var lastAttempt = null;
        try {
            lastAttempt = sessionStorage.getItem("haym_auto_update_attempt");
        } catch (e) {}

        HaymUpdater.checkForUpdates(function (info) {
            if (info && info.hasUpdate) {
                var targetTag = info.tag || ("v" + info.latestVersion);
                if (lastAttempt === targetTag) {
                    // Update was already attempted this session; show notification dot only
                    updateDot.classList.remove('hidden');
                    return;
                }

                try {
                    sessionStorage.setItem("haym_auto_update_attempt", targetTag);
                } catch (e) {}

                latestReleaseUrl = info.htmlUrl;
                currentUpdateTag = targetTag;
                startAutoUpdate(currentUpdateTag, info.latestVersion);
            }
        });
    }

    /**
     * Manual update check from Settings modal: checks and auto-installs immediately.
     */
    function triggerManualUpdateCheck() {
        if (isUpdating) return;
        updateStatusBox.className = "update-status-box";
        updateStatusBox.textContent = "Checking GitHub for updates...";
        btnCheckUpdates.disabled = true;

        HaymUpdater.checkForUpdates(function (info) {
            btnCheckUpdates.disabled = false;
            if (info.success) {
                if (info.hasUpdate) {
                    latestReleaseUrl = info.htmlUrl;
                    currentUpdateTag = info.tag || ("v" + info.latestVersion);
                    startAutoUpdate(currentUpdateTag, info.latestVersion);
                } else {
                    updateDot.classList.add('hidden');
                    updateStatusBox.className = "update-status-box";
                    updateStatusBox.textContent = "You are up to date! (v" + info.currentVersion + ")";
                    if (btnInstallUpdate) btnInstallUpdate.classList.add('hidden');
                }
            } else {
                updateStatusBox.className = "update-status-box error";
                updateStatusBox.textContent = info.message || "Failed to check for updates.";
            }
        });
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
