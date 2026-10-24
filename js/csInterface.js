/**
 * HaymGraph CSInterface Bridge
 * Supports native Adobe CEP runtime and standalone browser testing.
 */

(function (root, factory) {
    if (typeof exports === 'object' && typeof module !== 'undefined') {
        module.exports = factory();
    } else {
        root.CSInterface = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function CSInterface() {
        this.isCEP = (typeof window.__adobe_cep__ !== "undefined");
    }

    CSInterface.THEME_COLOR_CHANGED_EVENT = "com.adobe.csxs.events.ThemeColorChanged";

    /**
     * Evaluates an ExtendScript expression in AE host application.
     */
    CSInterface.prototype.evalScript = function (script, callback) {
        if (this.isCEP) {
            window.__adobe_cep__.evalScript(script, callback || function () {});
        } else {
            // High-fidelity browser mock for development and preview
            setTimeout(function () {
                if (!callback) return;

                if (script.indexOf("checkSelectionStatus") !== -1) {
                    callback(JSON.stringify({
                        hasComp: true,
                        propsCount: 2,
                        totalKeys: 4,
                        hasSpatialPosition: true
                    }));
                } else if (script.indexOf("applyBezier") !== -1) {
                    callback(JSON.stringify({
                        success: true,
                        keysCount: 4,
                        propsCount: 2,
                        message: "Applied curve to 4 segments on 2 properties."
                    }));
                } else if (script.indexOf("analyzeSelection") !== -1) {
                    callback(JSON.stringify({
                        success: true,
                        curve: { x1: 0.25, y1: 0.1, x2: 0.75, y2: 0.9 },
                        hasMixedCurves: false,
                        propName: "Scale (Mock)",
                        totalSegments: 2,
                        message: "Analyzed Scale (2 segments)"
                    }));
                } else if (script.indexOf("separateAndApply") !== -1) {
                    callback(JSON.stringify({
                        success: true,
                        separatedCount: 1,
                        keysCount: 4,
                        message: "Separated Position dimensions and applied curve to 4 segments."
                    }));
                } else {
                    callback(JSON.stringify({ success: true, message: "OK" }));
                }
            }, 50);
        }
    };

    /**
     * Registers interest in key events to prevent AE from consuming keys (like Enter).
     */
    CSInterface.prototype.registerKeyEventsInterest = function (keyEventsInterest) {
        if (this.isCEP && window.__adobe_cep__.registerKeyEventsInterest) {
            window.__adobe_cep__.registerKeyEventsInterest(keyEventsInterest);
        }
    };

    /**
     * Retrieves host environment info (theme colors, version).
     */
    CSInterface.prototype.getHostEnvironment = function () {
        if (this.isCEP && window.__adobe_cep__.getHostEnvironment) {
            try {
                return JSON.parse(window.__adobe_cep__.getHostEnvironment());
            } catch (e) {}
        }
        return {
            appName: "AEFT",
            appVersion: "24.0.0",
            appSkinInfo: {
                panelBackgroundColor: {
                    color: { red: 24, green: 25, blue: 28, alpha: 255 }
                }
            }
        };
    };

    /**
     * Listens to CEP events.
     */
    CSInterface.prototype.addEventListener = function (type, listener, obj) {
        if (this.isCEP && window.__adobe_cep__.addEventListener) {
            window.__adobe_cep__.addEventListener(type, listener, obj);
        }
    };

    /**
     * Retrieves system paths (e.g. extension path).
     */
    CSInterface.prototype.getSystemPath = function (pathType) {
        if (this.isCEP && window.__adobe_cep__.getSystemPath) {
            return window.__adobe_cep__.getSystemPath(pathType);
        }
        return "";
    };

    /**
     * Closes the panel.
     */
    CSInterface.prototype.closeExtension = function () {
        if (this.isCEP && window.__adobe_cep__.closeExtension) {
            window.__adobe_cep__.closeExtension();
        }
    };

    root.SystemPath = {
        USER_DATA: "userData",
        COMMON_FILES: "commonFiles",
        MY_DOCUMENTS: "myDocuments",
        APPLICATION: "application",
        EXTENSION: "extension",
        HOST_APPLICATION: "hostApplication"
    };

    return CSInterface;
}));
