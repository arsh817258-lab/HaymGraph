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
    var btnCopy = document.getElementById('btn-copy');
    var btnPaste = document.getElementById('btn-paste');
    var btnLiveSync = document.getElementById('btn-live-sync');
    var btnLibraryToggle = document.getElementById('btn-library-toggle');
    var appContainer = document.getElementById('app-container');

    // Presets Library DOM Elements & State
    var libraryPanel = document.getElementById('library-panel');
    var btnToggleLibrary = document.getElementById('btn-toggle-library');
    var presetNameInput = document.getElementById('preset-name-input');
    var btnSavePreset = document.getElementById('btn-save-preset');
    var presetList = document.getElementById('preset-list');
    var presets = [];
    var draggedPresetIndex = null;

    var DEFAULT_PRESETS = [
        { id: 'p_ease_out', name: 'Ease Out', curve: { x1: 0.16, y1: 1.0, x2: 0.3, y2: 1.0 } },
        { id: 'p_ease_in', name: 'Ease In', curve: { x1: 0.7, y1: 0.0, x2: 0.84, y2: 0.0 } },
        { id: 'p_ease_in_out', name: 'Ease In Out', curve: { x1: 0.4, y1: 0.0, x2: 0.2, y2: 1.0 } },
        { id: 'p_fast_out', name: 'Fast Out', curve: { x1: 0.05, y1: 0.95, x2: 0.15, y2: 1.0 } },
        { id: 'p_overshoot', name: 'Overshoot', curve: { x1: 0.2, y1: 1.35, x2: 0.6, y2: 1.0 } },
        { id: 'p_anticipate', name: 'Anticipate', curve: { x1: 0.35, y1: -0.25, x2: 0.6, y2: 1.0 } }
    ];

    var isLiveSyncEnabled = false;
    var liveSyncInterval = null;
    var lastSelectionFingerprint = "none";
    var isApplyingCurve = false;

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
    var settingLibraryRatioSlider = document.getElementById('setting-library-ratio-slider');
    var settingLibraryRatioVal = document.getElementById('setting-library-ratio-val');
    var settingLayoutGroup = document.getElementById('setting-layout-group');
    var currentLayoutPref = 'auto';
    var currentUpdateTag = null;

    function init() {
        // 1. Initialize CurveBox
        curveBox = new CurveBox('#curve-box-container', {
            onCurveChange: handleCurveChange,
            onCurveRelease: handleCurveRelease
        });

        // 2. Proactively reload latest ExtendScript host engine into AE memory
        reloadHostScript();

        // 2. Register key interest for Enter, Ctrl, Alt/Option, Shift, Copy (C), Paste (V) in CEP (Win & Mac)
        try {
            var keyEventsInterest = JSON.stringify([
                { keyCode: 13 }, // Enter
                { keyCode: 17, ctrlKey: true }, // Ctrl
                { keyCode: 18, altKey: true },  // Alt / Option
                { keyCode: 16, shiftKey: true }, // Shift
                { keyCode: 67, ctrlKey: true }, // Ctrl+C
                { keyCode: 86, ctrlKey: true }, // Ctrl+V
                { keyCode: 67, metaKey: true }, // Cmd+C (macOS)
                { keyCode: 86, metaKey: true }, // Cmd+V (macOS)
                { keyCode: 91, metaKey: true }, // Left Cmd (macOS)
                { keyCode: 93, metaKey: true }  // Right Cmd (macOS)
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
        if (btnCopy) btnCopy.addEventListener('click', copyCurveToClipboard);
        if (btnPaste) btnPaste.addEventListener('click', pasteCurveFromClipboard);

        // Bind Live Sync toggle button
        if (btnLiveSync) {
            btnLiveSync.addEventListener('click', toggleLiveSync);
            var savedLiveSync = localStorage.getItem('haymgraph_live_sync');
            if (savedLiveSync === 'true') {
                setLiveSyncState(true);
            } else {
                setLiveSyncState(false);
            }
        }

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
            } else if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
                // Don't intercept if typing in an input
                if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
                e.preventDefault();
                copyCurveToClipboard();
            } else if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
                if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
                e.preventDefault();
                pasteCurveFromClipboard();
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

        // 11. Presets Library Initialization
        loadPresets();
        renderPresetList();
        if (btnSavePreset) {
            btnSavePreset.addEventListener('click', saveCurrentPreset);
        }
        if (presetNameInput) {
            presetNameInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    saveCurrentPreset();
                }
            });
        }

        // Bind Library Collapse/Expand Toggles (Header & Panel)
        if (btnLibraryToggle) {
            btnLibraryToggle.addEventListener('click', toggleLibrary);
        }
        if (btnToggleLibrary) {
            btnToggleLibrary.addEventListener('click', toggleLibrary);
        }

        // Restore saved library collapse state
        try {
            var savedLibraryCollapsed = localStorage.getItem('haymgraph_library_collapsed');
            if (savedLibraryCollapsed === 'true') {
                setLibraryCollapsed(true);
            } else {
                setLibraryCollapsed(false);
            }
        } catch (e) {}

        // Settings Library Ratio Slider
        if (settingLibraryRatioSlider) {
            settingLibraryRatioSlider.addEventListener('input', function () {
                setLibraryRatio(settingLibraryRatioSlider.value);
            });
            try {
                var savedRatio = localStorage.getItem('haymgraph_library_ratio');
                if (savedRatio) {
                    setLibraryRatio(savedRatio);
                } else {
                    setLibraryRatio(35);
                }
            } catch (e) {}
        }

        // Settings Library Layout Preference (auto, vertical, horizontal)
        if (settingLayoutGroup) {
            settingLayoutGroup.addEventListener('click', function (e) {
                var btn = e.target.closest('.setting-segment-btn');
                if (btn) {
                    var layout = btn.getAttribute('data-layout');
                    if (layout) setLayoutPreference(layout);
                }
            });
            try {
                var savedPref = localStorage.getItem('haymgraph_library_layout_pref');
                if (savedPref) {
                    setLayoutPreference(savedPref);
                } else {
                    setLayoutPreference('auto');
                }
            } catch (e) {}
        }

        // 12. Auto-Resizing Layout (Vertical & Horizontal)
        updateLayoutMode();
        window.addEventListener('resize', updateLayoutMode);
    }

    /**
     * Copies current curve values to the system clipboard and internal storage.
     */
    function copyCurveToClipboard() {
        var c = curveBox.curve;
        var text = c.x1 + ", " + c.y1 + ", " + c.x2 + ", " + c.y2;
        var jsonText = JSON.stringify({ x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2 });

        try {
            localStorage.setItem('haymgraph_clipboard_curve', jsonText);
        } catch (e) {}

        var copied = false;

        // Method 1: Electron / Node.js clipboard (if enabled in CEP)
        try {
            if (typeof require === 'function') {
                var electron = require('electron');
                if (electron && electron.clipboard) {
                    electron.clipboard.writeText(text);
                    copied = true;
                }
            }
        } catch (e) {}

        // Method 2: Standard HTML document.execCommand('copy') with attached input
        if (!copied) {
            try {
                var input = document.createElement('input');
                input.setAttribute('value', text);
                input.style.position = 'fixed';
                input.style.top = '0';
                input.style.left = '0';
                input.style.opacity = '0';
                input.style.pointerEvents = 'none';
                document.body.appendChild(input);
                input.focus();
                input.select();
                copied = document.execCommand('copy');
                document.body.removeChild(input);
            } catch (err) {}
        }

        // Method 3: Async navigator.clipboard
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(function () {});
        }

        setStatus("Copied curve: " + text, true);
    }

    /**
     * Pastes curve values from system clipboard or internal storage.
     */
    function pasteCurveFromClipboard() {
        function applyParsed(data) {
            if (!data) return false;
            var x1, y1, x2, y2;

            if (typeof data === 'object' && ('x1' in data)) {
                x1 = Number(data.x1);
                y1 = Number(data.y1);
                x2 = Number(data.x2);
                y2 = Number(data.y2);
            } else if (typeof data === 'string') {
                var clean = data.replace(/cubic-bezier\s*\(/i, '').replace(/\)/, '').trim();
                var parts = clean.split(/[\s,]+/);
                if (parts.length >= 4) {
                    x1 = parseFloat(parts[0]);
                    y1 = parseFloat(parts[1]);
                    x2 = parseFloat(parts[2]);
                    y2 = parseFloat(parts[3]);
                }
            }

            if (!isNaN(x1) && !isNaN(y1) && !isNaN(x2) && !isNaN(y2)) {
                curveBox.setCurve({ x1: x1, y1: y1, x2: x2, y2: y2 });
                setStatus("Pasted curve: " + x1 + ", " + y1 + ", " + x2 + ", " + y2, true);
                return true;
            }
            return false;
        }

        // Try Method 1: Electron / Node.js clipboard
        try {
            if (typeof require === 'function') {
                var electron = require('electron');
                if (electron && electron.clipboard) {
                    var text = electron.clipboard.readText();
                    if (applyParsed(text)) return;
                }
            }
        } catch (e) {}

        // Try Method 2: navigator.clipboard
        if (navigator.clipboard && navigator.clipboard.readText) {
            navigator.clipboard.readText().then(function (clipText) {
                if (!applyParsed(clipText)) {
                    fallbackInternalPaste();
                }
            }).catch(function () {
                fallbackInternalPaste();
            });
            return;
        }

        fallbackInternalPaste();

        function fallbackInternalPaste() {
            try {
                var stored = localStorage.getItem('haymgraph_clipboard_curve');
                if (stored && applyParsed(JSON.parse(stored))) {
                    return;
                }
            } catch (e) {}
            setStatus("No valid curve on clipboard (format: x1, y1, x2, y2)", false);
        }
    }

    /**
     * Curve change handler - updates extrema badge & overshoot UI in real-time.
     */
    function handleCurveChange(curve, extrema, handleIndex) {
        currentExtrema = extrema;

        // Viewport extrema badge
        if (badgeExtrema) {
            badgeExtrema.textContent = "Y: [" + extrema.minY.toFixed(2) + ", " + extrema.maxY.toFixed(2) + "]";
            if (extrema.hasOvershoot) {
                badgeExtrema.classList.add('overshoot');
            } else {
                badgeExtrema.classList.remove('overshoot');
            }
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
     * Proactively loads host.jsx into ExtendScript memory.
     */
    function reloadHostScript() {
        try {
            var extPath = csInterface.getSystemPath(CSInterface.SystemPath ? CSInterface.SystemPath.EXTENSION : "extension");
            if (extPath) {
                var cleanPath = extPath.replace(/\\/g, "/");
                if (cleanPath.charAt(cleanPath.length - 1) !== "/") {
                    cleanPath += "/";
                }
                csInterface.evalScript('$.evalFile("' + cleanPath + 'jsx/host.jsx")');
            }
        } catch (e) {}
    }

    /**
     * Executes standard apply curve to host.
     */
    function executeApplyCurve() {
        isApplyingCurve = true;
        setStatus("Applying curve...", false);
        var c = curveBox.curve;
        var script = "(HaymHost.applyBezierValues ? HaymHost.applyBezierValues(" + c.x1 + ", " + c.y1 + ", " + c.x2 + ", " + c.y2 + ") : HaymHost.applyBezier({x1:" + c.x1 + ", y1:" + c.y1 + ", x2:" + c.x2 + ", y2:" + c.y2 + "}))";

        csInterface.evalScript(script, function (resStr) {
            isApplyingCurve = false;
            try {
                var res = (typeof resStr === "object") ? resStr : JSON.parse(resStr);
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

        var c = curveBox.curve;
        var script = "(HaymHost.separateAndApplyValues ? HaymHost.separateAndApplyValues(" + c.x1 + ", " + c.y1 + ", " + c.x2 + ", " + c.y2 + ") : HaymHost.separateAndApply({curve:{x1:" + c.x1 + ", y1:" + c.y1 + ", x2:" + c.x2 + ", y2:" + c.y2 + "}}))";
        csInterface.evalScript(script, function (resStr) {
            try {
                var res = (typeof resStr === "object") ? resStr : JSON.parse(resStr);
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
        performAnalyze(false);
    }

    /**
     * Core Analyze implementation for both manual and live sync triggers.
     */
    function performAnalyze(isLive) {
        if (!isLive) {
            setStatus("Analyzing selection...", false);
        }
        csInterface.evalScript("HaymHost.analyzeSelection()", function (resStr) {
            try {
                var res = JSON.parse(resStr);
                if (res.success && res.curve) {
                    curveBox.setCurve(res.curve);

                    if (res.hasMixedCurves) {
                        setWarningStatus(res.message);
                    } else {
                        setStatus(res.message, true);
                    }
                } else {
                    if (!isLive) {
                        setStatus(res.message || "Could not analyze", false);
                    }
                }
            } catch (err) {
                if (!isLive) {
                    setStatus("Analyze error: " + err.toString(), false);
                }
            }
        });
    }

    /**
     * Live Sync: Called when user moves and releases a handle in CurveBox.
     */
    function handleCurveRelease(curve) {
        if (!isLiveSyncEnabled) return;

        // Auto-apply curve to selected keyframes
        refreshSelectionStatus(function (status) {
            if (!status || !status.hasComp || status.totalKeys === 0) {
                return;
            }
            if (currentExtrema.hasOvershoot && hasSpatialNonSeparatedPosition) {
                openOvershootModal();
            } else {
                executeApplyCurve();
            }
        });
    }

    /**
     * Toggles the Live Auto-Sync mode.
     */
    function toggleLiveSync() {
        setLiveSyncState(!isLiveSyncEnabled);
    }

    function setLiveSyncState(enable) {
        isLiveSyncEnabled = !!enable;
        try {
            localStorage.setItem('haymgraph_live_sync', isLiveSyncEnabled ? 'true' : 'false');
        } catch (e) {}

        if (btnLiveSync) {
            if (isLiveSyncEnabled) {
                btnLiveSync.classList.add('active');
                btnLiveSync.setAttribute('aria-pressed', 'true');
                btnLiveSync.title = "Live Sync: ON (Auto-analyzing selection & auto-applying on handle release)";
            } else {
                btnLiveSync.classList.remove('active');
                btnLiveSync.setAttribute('aria-pressed', 'false');
                btnLiveSync.title = "Live Sync: OFF (Click to auto-analyze on selection & auto-apply on release)";
            }
        }

        if (isLiveSyncEnabled) {
            startLiveSyncPolling();
            setStatus("Live Sync enabled", true);
        } else {
            stopLiveSyncPolling();
            setStatus("Live Sync disabled", false);
            if (mixedIndicator) mixedIndicator.style.display = 'none';
        }
    }

    function startLiveSyncPolling() {
        stopLiveSyncPolling();
        lastSelectionFingerprint = "none";
        checkLiveSyncSelection();
        liveSyncInterval = setInterval(checkLiveSyncSelection, 300);
    }

    function stopLiveSyncPolling() {
        if (liveSyncInterval) {
            clearInterval(liveSyncInterval);
            liveSyncInterval = null;
        }
    }

    /**
     * Periodic selection checker when Live Sync is active.
     */
    function checkLiveSyncSelection() {
        if (!isLiveSyncEnabled) return;
        if (curveBox && curveBox.isDragging) return;
        if (isApplyingCurve) return;
        if (overshootModal && overshootModal.classList.contains('open')) return;
        if (settingsModal && settingsModal.classList.contains('open')) return;

        csInterface.evalScript("HaymHost.getSelectionFingerprint()", function (resStr) {
            try {
                var res = JSON.parse(resStr);
                if (!res.hasKeys) {
                    if (lastSelectionFingerprint !== "none") {
                        lastSelectionFingerprint = "none";
                        setStatus("Ready (No keyframes selected)", false);
                    }
                    return;
                }

                if (res.fingerprint !== lastSelectionFingerprint) {
                    lastSelectionFingerprint = res.fingerprint;
                    performAnalyze(true);
                }
            } catch (err) {}
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
        if (statusMsg.parentElement) {
            statusMsg.parentElement.classList.remove('warning');
        }
        if (isActive) {
            statusDot.className = 'status-dot active';
        } else {
            statusDot.className = 'status-dot';
        }
        if (mixedIndicator) {
            mixedIndicator.style.display = 'none';
        }
    }

    function setWarningStatus(text) {
        statusMsg.textContent = text;
        if (statusMsg.parentElement) {
            statusMsg.parentElement.classList.add('warning');
        }
        statusDot.className = 'status-dot warning';
        if (mixedIndicator) {
            mixedIndicator.style.display = 'flex';
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

    /**
     * Auto-resizes the interface between vertical and horizontal orientations
     * dynamically depending on panel dimensions in After Effects.
     */
    function updateLayoutMode() {
        var appContainer = document.getElementById('app-container');
        if (!appContainer) return;
        var w = window.innerWidth || document.documentElement.clientWidth;
        var h = window.innerHeight || document.documentElement.clientHeight;
        if (w >= 400 && w > h * 1.05) {
            appContainer.classList.add('layout-horizontal');
        } else {
            appContainer.classList.remove('layout-horizontal');
        }
        if (curveBox) {
            curveBox.resize();
        }
    }

    /**
     * Presets Library storage and management.
     */
    function loadPresets() {
        try {
            var stored = localStorage.getItem('haymgraph_presets');
            if (stored) {
                var parsed = JSON.parse(stored);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    presets = parsed;
                    return;
                }
            }
        } catch (e) {}
        presets = JSON.parse(JSON.stringify(DEFAULT_PRESETS));
        savePresets();
    }

    function savePresets() {
        try {
            localStorage.setItem('haymgraph_presets', JSON.stringify(presets));
        } catch (e) {}
    }

    function generateCurveSvgPath(c) {
        var x1 = typeof c.x1 === 'number' ? c.x1 : 0.333;
        var y1 = typeof c.y1 === 'number' ? c.y1 : 0.0;
        var x2 = typeof c.x2 === 'number' ? c.x2 : 0.667;
        var y2 = typeof c.y2 === 'number' ? c.y2 : 1.0;

        var px1 = 3 + x1 * 26;
        var py1 = 29 - y1 * 26;
        var px2 = 3 + x2 * 26;
        var py2 = 29 - y2 * 26;

        return 'M 3 29 C ' + px1.toFixed(1) + ' ' + py1.toFixed(1) + ', ' + px2.toFixed(1) + ' ' + py2.toFixed(1) + ', 29 3';
    }

    function renderPresetList() {
        if (!presetList) return;
        presetList.innerHTML = '';

        if (!presets || presets.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'preset-empty';
            empty.textContent = 'No presets saved yet. Type a name and click Save.';
            presetList.appendChild(empty);
            return;
        }

        presets.forEach(function (preset, index) {
            var item = document.createElement('div');
            item.className = 'preset-item';
            item.setAttribute('draggable', 'true');
            item.setAttribute('data-index', index);
            item.title = 'Click to load ' + preset.name + ' (Drag to reorder)';

            // Preview Thumbnail SVG
            var previewWrap = document.createElement('div');
            previewWrap.className = 'preset-preview-wrap';
            var pathD = generateCurveSvgPath(preset.curve);
            previewWrap.innerHTML = '<svg class="preset-svg" viewBox="0 0 32 32">' +
                '<line x1="3" y1="29" x2="29" y2="29" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>' +
                '<line x1="3" y1="3" x2="29" y2="3" stroke="rgba(255,255,255,0.06)" stroke-dasharray="2,2"/>' +
                '<path d="' + pathD + '" fill="none" stroke="#066CE7" stroke-width="2" stroke-linecap="round"/>' +
                '</svg>';
            item.appendChild(previewWrap);

            // Title
            var title = document.createElement('span');
            title.className = 'preset-title';
            title.textContent = preset.name;
            item.appendChild(title);

            // Delete Button
            var btnDelete = document.createElement('button');
            btnDelete.className = 'preset-btn-delete';
            btnDelete.title = 'Delete preset';
            btnDelete.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
            btnDelete.addEventListener('click', function (e) {
                e.stopPropagation();
                presets.splice(index, 1);
                savePresets();
                renderPresetList();
                setStatus("Deleted preset", false);
            });
            item.appendChild(btnDelete);

            // Click to load curve into CurveBox
            item.addEventListener('click', function () {
                var allItems = presetList.querySelectorAll('.preset-item');
                allItems.forEach(function (el) { el.classList.remove('active'); });
                item.classList.add('active');

                curveBox.setCurve(preset.curve);
                setStatus("Loaded preset: " + preset.name, true);
                if (isLiveSyncEnabled) {
                    handleCurveRelease(preset.curve);
                }
            });

            // HTML5 Drag and Drop for Slotting Order
            item.addEventListener('dragstart', function (e) {
                draggedPresetIndex = index;
                item.classList.add('dragging');
                if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', index);
                }
            });

            item.addEventListener('dragover', function (e) {
                e.preventDefault();
                if (e.dataTransfer) {
                    e.dataTransfer.dropEffect = 'move';
                }
            });

            item.addEventListener('dragenter', function (e) {
                e.preventDefault();
                if (draggedPresetIndex !== index) {
                    item.classList.add('drag-over');
                }
            });

            item.addEventListener('dragleave', function () {
                item.classList.remove('drag-over');
            });

            item.addEventListener('drop', function (e) {
                e.preventDefault();
                item.classList.remove('drag-over');
                if (draggedPresetIndex !== null && draggedPresetIndex !== index) {
                    var moved = presets.splice(draggedPresetIndex, 1)[0];
                    presets.splice(index, 0, moved);
                    savePresets();
                    renderPresetList();
                    setStatus("Reordered preset: " + moved.name, true);
                }
            });

            item.addEventListener('dragend', function () {
                draggedPresetIndex = null;
                var allItems = presetList.querySelectorAll('.preset-item');
                allItems.forEach(function (el) {
                    el.classList.remove('dragging');
                    el.classList.remove('drag-over');
                });
            });

            presetList.appendChild(item);
        });
    }

    function saveCurrentPreset() {
        if (!presetNameInput) return;
        var name = presetNameInput.value.trim();
        if (!name) {
            name = "Preset " + (presets.length + 1);
        }

        var c = curveBox.curve;
        var newPreset = {
            id: 'preset_' + Date.now(),
            name: name,
            curve: {
                x1: c.x1,
                y1: c.y1,
                x2: c.x2,
                y2: c.y2
            }
        };

        presets.push(newPreset);
        savePresets();
        presetNameInput.value = '';
        renderPresetList();
        setStatus("Saved preset: " + name, true);
    }

    /**
     * Collapses or expands the Presets Library panel cleanly.
     * When collapsed, the library completely disappears and CurveBox expands to 100%.
     */
    function setLibraryCollapsed(collapsed) {
        if (!appContainer) return;
        if (collapsed) {
            appContainer.classList.add('library-collapsed');
            if (libraryPanel) libraryPanel.classList.add('collapsed');
            if (btnLibraryToggle) {
                btnLibraryToggle.classList.remove('active');
                btnLibraryToggle.setAttribute('aria-pressed', 'false');
            }
        } else {
            appContainer.classList.remove('library-collapsed');
            if (libraryPanel) libraryPanel.classList.remove('collapsed');
            if (btnLibraryToggle) {
                btnLibraryToggle.classList.add('active');
                btnLibraryToggle.setAttribute('aria-pressed', 'true');
            }
        }
        try {
            localStorage.setItem('haymgraph_library_collapsed', collapsed ? 'true' : 'false');
        } catch (e) {}

        if (curveBox) {
            setTimeout(function () {
                curveBox.resize();
            }, 40);
        }
    }

    function toggleLibrary() {
        var isCurrentlyCollapsed = appContainer ? (appContainer.classList.contains('library-collapsed') || (libraryPanel && libraryPanel.classList.contains('collapsed'))) : false;
        setLibraryCollapsed(!isCurrentlyCollapsed);
    }

    /**
     * Sets the width ratio of the Presets Library (15% to 60%).
     */
    function setLibraryRatio(ratio) {
        var r = parseInt(ratio, 10);
        if (isNaN(r) || r < 15 || r > 60) {
            r = 35;
        }
        if (appContainer) {
            appContainer.style.setProperty('--library-ratio', r + '%');
        }
        if (settingLibraryRatioVal) {
            settingLibraryRatioVal.textContent = r + '%';
        }
        if (settingLibraryRatioSlider) {
            settingLibraryRatioSlider.value = r;
        }
        try {
            localStorage.setItem('haymgraph_library_ratio', r);
        } catch (e) {}
        if (curveBox) {
            setTimeout(function () {
                curveBox.resize();
            }, 30);
        }
    }

    /**
     * Sets user library layout preference: 'auto', 'vertical', or 'horizontal'.
     */
    function setLayoutPreference(pref) {
        if (pref !== 'auto' && pref !== 'vertical' && pref !== 'horizontal') {
            pref = 'auto';
        }
        currentLayoutPref = pref;
        try {
            localStorage.setItem('haymgraph_library_layout_pref', pref);
        } catch (e) {}

        if (settingLayoutGroup) {
            var btns = settingLayoutGroup.querySelectorAll('.setting-segment-btn');
            for (var i = 0; i < btns.length; i++) {
                if (btns[i].getAttribute('data-layout') === pref) {
                    btns[i].classList.add('active');
                } else {
                    btns[i].classList.remove('active');
                }
            }
        }

        updateLayoutMode();
    }

    /**
     * Switches between horizontal and vertical layouts based on preference and panel dimensions.
     */
    function updateLayoutMode() {
        if (!appContainer) return;
        var isHorizontal = false;

        if (currentLayoutPref === 'horizontal') {
            isHorizontal = true;
        } else if (currentLayoutPref === 'vertical') {
            isHorizontal = false;
        } else {
            // Auto mode: dynamic aspect ratio and width detection
            isHorizontal = window.innerWidth > 330 && (window.innerWidth / Math.max(1, window.innerHeight)) >= 0.85;
        }

        if (isHorizontal) {
            appContainer.classList.add('layout-horizontal');
            appContainer.classList.remove('layout-vertical');
        } else {
            appContainer.classList.remove('layout-horizontal');
            appContainer.classList.add('layout-vertical');
        }
        if (curveBox) {
            curveBox.resize();
        }
    }

    // Initialize once DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
