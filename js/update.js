/**
 * HaymGraph Auto-Updater
 * Checks GitHub repository releases for newer versions,
 * alerts user, and handles seamless in-place extension updates via JavaScript.
 */

(function (root, factory) {
    if (typeof exports === 'object' && typeof module !== 'undefined') {
        module.exports = factory();
    } else {
        root.HaymUpdater = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var CURRENT_VERSION = "1.0.1";
    var DEFAULT_REPO = "arsh817258-lab/HaymGraph";
    var STORAGE_KEY_AUTOCHECK = "haymgraph_autocheck_update";

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
        var repo = DEFAULT_REPO;
        var apiUrl = "https://api.github.com/repos/" + repo + "/releases/latest?t=" + Date.now();
        var rawUrl = "https://raw.githubusercontent.com/" + repo + "/main/package.json?t=" + Date.now();

        fetch(apiUrl, {
            headers: { 'Accept': 'application/vnd.github.v3+json' }
        })
        .then(function (res) {
            if (res.ok) {
                return res.json().then(function (data) {
                    var latestTag = data.tag_name || data.name || "0.0.0";
                    var cleanTag = latestTag.replace(/^[vV]/, '');
                    var isNewer = compareVersions(cleanTag, CURRENT_VERSION) > 0;
                    callback({
                        success: true,
                        hasUpdate: isNewer,
                        currentVersion: CURRENT_VERSION,
                        latestVersion: cleanTag,
                        releaseName: data.name || latestTag,
                        releaseNotes: data.body || "",
                        htmlUrl: data.html_url || ("https://github.com/" + repo + "/releases"),
                        tag: latestTag
                    });
                });
            } else {
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
                                tag: "v" + rawVer
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
     * In-place auto-updater: downloads latest files from GitHub and overwrites local extension.
     */
    function installUpdateInPlace(targetTag, onProgress, onComplete) {
        var repo = DEFAULT_REPO;
        var tag = targetTag || "main";

        // Query GitHub repository tree
        var treeUrl = "https://api.github.com/repos/" + repo + "/git/trees/" + tag + "?recursive=1";

        onProgress("Fetching file list from GitHub...");

        fetch(treeUrl, {
            headers: { 'Accept': 'application/vnd.github.v3+json' }
        })
        .then(function (res) {
            if (!res.ok) {
                // If tag tree lookup fails, try main branch tree
                return fetch("https://api.github.com/repos/" + repo + "/git/trees/main?recursive=1", {
                    headers: { 'Accept': 'application/vnd.github.v3+json' }
                }).then(function (r) {
                    if (!r.ok) throw new Error("Could not retrieve file list from GitHub.");
                    return r.json();
                });
            }
            return res.json();
        })
        .then(function (treeData) {
            var files = (treeData.tree || []).filter(function (item) {
                return item.type === "blob" &&
                       !item.path.startsWith(".git") &&
                       !item.path.startsWith("test/") &&
                       !item.path.endsWith(".log") &&
                       item.path !== ".gitignore";
            });

            if (files.length === 0) {
                throw new Error("No update files found in repository.");
            }

            var nodeFs = null;
            var nodePath = null;
            var baseDir = "";

            try {
                if (typeof window !== "undefined" && typeof window.require === "function") {
                    nodeFs = window.require("fs");
                    nodePath = window.require("path");
                    baseDir = (typeof __dirname !== "undefined") ? __dirname : "";
                }
            } catch (e) {}

            var completed = 0;
            var total = files.length;

            function downloadNext(index) {
                if (index >= files.length) {
                    onProgress("Update complete! Reloading panel...");
                    setTimeout(function () {
                        onComplete({ success: true });
                        if (typeof window !== "undefined" && window.location) {
                            window.location.reload();
                        }
                    }, 1200);
                    return;
                }

                var item = files[index];
                onProgress("Updating (" + (index + 1) + "/" + total + "): " + item.path);

                var rawUrl = "https://raw.githubusercontent.com/" + repo + "/" + tag + "/" + item.path + "?t=" + Date.now();

                fetch(rawUrl)
                .then(function (fileRes) {
                    if (!fileRes.ok) throw new Error("Failed to download " + item.path);
                    return fileRes.text();
                })
                .then(function (content) {
                    if (nodeFs && nodePath && baseDir) {
                        var targetFilePath = nodePath.join(baseDir, item.path);
                        var targetDir = nodePath.dirname(targetFilePath);
                        if (!nodeFs.existsSync(targetDir)) {
                            nodeFs.mkdirSync(targetDir, { recursive: true });
                        }
                        nodeFs.writeFileSync(targetFilePath, content, "utf8");
                    }
                    downloadNext(index + 1);
                })
                .catch(function (err) {
                    // Try falling back to main branch for raw URL if tag failed
                    var fallbackUrl = "https://raw.githubusercontent.com/" + repo + "/main/" + item.path + "?t=" + Date.now();
                    fetch(fallbackUrl)
                    .then(function (fbRes) { return fbRes.text(); })
                    .then(function (content) {
                        if (nodeFs && nodePath && baseDir) {
                            var targetFilePath = nodePath.join(baseDir, item.path);
                            var targetDir = nodePath.dirname(targetFilePath);
                            if (!nodeFs.existsSync(targetDir)) {
                                nodeFs.mkdirSync(targetDir, { recursive: true });
                            }
                            nodeFs.writeFileSync(targetFilePath, content, "utf8");
                        }
                        downloadNext(index + 1);
                    })
                    .catch(function (fbErr) {
                        onComplete({ success: false, message: "Error updating " + item.path + ": " + fbErr.message });
                    });
                });
            }

            downloadNext(0);
        })
        .catch(function (err) {
            onComplete({ success: false, message: err.message || "Update installation failed." });
        });
    }

    /**
     * Opens the release download page in system default browser (fallback).
     */
    function openDownloadPage(url) {
        var targetUrl = url || ("https://github.com/" + DEFAULT_REPO + "/releases/latest");
        if (typeof window !== "undefined" && typeof window.__adobe_cep__ !== "undefined" && window.__adobe_cep__.openURLInDefaultBrowser) {
            window.__adobe_cep__.openURLInDefaultBrowser(targetUrl);
        } else if (typeof window !== "undefined") {
            window.open(targetUrl, "_blank");
        }
    }

    return {
        CURRENT_VERSION: CURRENT_VERSION,
        DEFAULT_REPO: DEFAULT_REPO,
        isAutoCheckEnabled: isAutoCheckEnabled,
        setAutoCheckEnabled: setAutoCheckEnabled,
        compareVersions: compareVersions,
        checkForUpdates: checkForUpdates,
        installUpdateInPlace: installUpdateInPlace,
        openDownloadPage: openDownloadPage
    };
}));
