/**
 * HaymGraph Auto-Updater
 * Checks GitHub repository releases for newer versions,
 * alerts user, and handles seamless extension updates.
 */

(function (root, factory) {
    if (typeof exports === 'object' && typeof module !== 'undefined') {
        module.exports = factory();
    } else {
        root.HaymUpdater = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var CURRENT_VERSION = "1.0.0";
    var DEFAULT_REPO = "arsh817258-lab/HaymGraph";
    var STORAGE_KEY_REPO = "haymgraph_github_repo";
    var STORAGE_KEY_AUTOCHECK = "haymgraph_autocheck_update";

    function getRepo() {
        try {
            return localStorage.getItem(STORAGE_KEY_REPO) || DEFAULT_REPO;
        } catch (e) {
            return DEFAULT_REPO;
        }
    }

    function setRepo(repoName) {
        try {
            localStorage.setItem(STORAGE_KEY_REPO, repoName.trim());
        } catch (e) {}
    }

    function isAutoCheckEnabled() {
        try {
            var val = localStorage.getItem(STORAGE_KEY_AUTOCHECK);
            return val === null ? true : val === "true";
        } catch (e) {
            return true;
        }
    }

    function setAutoCheckEnabled(enabled) {
        try {
            localStorage.setItem(STORAGE_KEY_AUTOCHECK, enabled ? "true" : "false");
        } catch (e) {}
    }

    /**
     * Compares two semantic version strings.
     * Returns:
     *   1 if v1 > v2
     *  -1 if v1 < v2
     *   0 if v1 === v2
     */
    function compareVersions(v1, v2) {
        if (!v1 || !v2) return 0;
        var clean1 = String(v1).replace(/^[vV]/, '').split('.');
        var clean2 = String(v2).replace(/^[vV]/, '').split('.');

        for (var i = 0; i < 3; i++) {
            var num1 = parseInt(clean1[i] || '0', 10);
            var num2 = parseInt(clean2[i] || '0', 10);
            if (num1 > num2) return 1;
            if (num1 < num2) return -1;
        }
        return 0;
    }

    /**
     * Checks GitHub for the latest release or package.json tag.
     */
    function checkForUpdates(callback) {
        var repo = getRepo();
        var apiUrl = "https://api.github.com/repos/" + repo + "/releases/latest";
        var rawUrl = "https://raw.githubusercontent.com/" + repo + "/main/package.json";

        // Attempt GitHub releases API first
        fetch(apiUrl, {
            headers: { 'Accept': 'application/vnd.github.v3+json' }
        })
        .then(function (res) {
            if (res.ok) {
                return res.json().then(function (data) {
                    var latestTag = data.tag_name || data.name || "0.0.0";
                    var isNewer = compareVersions(latestTag, CURRENT_VERSION) > 0;
                    callback({
                        success: true,
                        hasUpdate: isNewer,
                        currentVersion: CURRENT_VERSION,
                        latestVersion: latestTag.replace(/^[vV]/, ''),
                        releaseName: data.name || latestTag,
                        releaseNotes: data.body || "",
                        htmlUrl: data.html_url || ("https://github.com/" + repo + "/releases"),
                        zipUrl: data.zipball_url || null
                    });
                });
            } else {
                // Fallback to checking package.json on main branch
                return fetch(rawUrl).then(function (rawRes) {
                    if (rawRes.ok) {
                        return rawRes.json().then(function (pkg) {
                            var rawVer = pkg.version || "0.0.0";
                            var isNewer = compareVersions(rawVer, CURRENT_VERSION) > 0;
                            callback({
                                success: true,
                                hasUpdate: isNewer,
                                currentVersion: CURRENT_VERSION,
                                latestVersion: rawVer,
                                releaseName: "v" + rawVer,
                                releaseNotes: "New update published to GitHub main branch.",
                                htmlUrl: "https://github.com/" + repo,
                                zipUrl: null
                            });
                        });
                    }
                    throw new Error("Repository not found or no releases yet.");
                });
            }
        })
        .catch(function (err) {
            callback({
                success: false,
                currentVersion: CURRENT_VERSION,
                message: err.message || "Failed to reach GitHub."
            });
        });
    }

    /**
     * Opens the release download page in system default browser.
     */
    function openDownloadPage(url) {
        var targetUrl = url || ("https://github.com/" + getRepo() + "/releases/latest");
        if (typeof window.__adobe_cep__ !== "undefined" && window.__adobe_cep__.openURLInDefaultBrowser) {
            window.__adobe_cep__.openURLInDefaultBrowser(targetUrl);
        } else {
            window.open(targetUrl, "_blank");
        }
    }

    return {
        CURRENT_VERSION: CURRENT_VERSION,
        DEFAULT_REPO: DEFAULT_REPO,
        getRepo: getRepo,
        setRepo: setRepo,
        isAutoCheckEnabled: isAutoCheckEnabled,
        setAutoCheckEnabled: setAutoCheckEnabled,
        compareVersions: compareVersions,
        checkForUpdates: checkForUpdates,
        openDownloadPage: openDownloadPage
    };
}));
