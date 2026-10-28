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

    var CURRENT_VERSION = "1.5.1";
    var DEFAULT_REPO = "arsh817258-lab/HaymGraph";
    var STORAGE_KEY_AUTOCHECK = "haymgraph_autocheck_update";

    var DEFAULT_EXTENSION_FILES = [
        "index.html",
        "package.json",
        "README.md",
        "install.bat",
        "install.sh",
        ".debug",
        "css/style.css",
        "CSXS/manifest.xml",
        "js/app.js",
        "js/coreMath.js",
        "js/csInterface.js",
        "js/curveBox.js",
        "js/update.js",
        "jsx/host.jsx",
        "jsx/json2.js"
    ];

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

    function cleanDirectoryPath(rawPath) {
        if (!rawPath) return "";
        var p = String(rawPath);
        try {
            p = decodeURIComponent(p);
        } catch (e) {
            try { p = decodeURI(p); } catch (e2) {}
        }
        p = p.replace(/^file:\/{2,3}/i, '');
        if (/^\/[a-zA-Z]:/.test(p)) {
            p = p.substring(1);
        }
        return p.replace(/\\/g, '/').replace(/\/+$/, '');
    }

    /**
     * In-place auto-updater: downloads latest files from GitHub and overwrites local extension.
     */
    function installUpdateInPlace(targetTag, onProgress, onComplete, customBaseDir) {
        var repo = DEFAULT_REPO;
        var tag = targetTag || "main";

        if (typeof onProgress !== "function") onProgress = function () {};
        if (typeof onComplete !== "function") onComplete = function () {};

        // Query GitHub repository tree
        var treeUrl = "https://api.github.com/repos/" + repo + "/git/trees/" + tag + "?recursive=1";

        onProgress("Checking files for update " + tag + "...");

        fetch(treeUrl, {
            headers: { 'Accept': 'application/vnd.github.v3+json' }
        })
        .then(function (res) {
            if (!res.ok) {
                // If tag tree lookup fails, try main branch tree
                return fetch("https://api.github.com/repos/" + repo + "/git/trees/main?recursive=1", {
                    headers: { 'Accept': 'application/vnd.github.v3+json' }
                }).then(function (r) {
                    if (!r.ok) {
                        // GitHub REST API rate-limited (HTTP 403) or blocked:
                        // Fall back to known extension files so in-place update succeeds via raw CDN without rate limit
                        return {
                            tree: DEFAULT_EXTENSION_FILES.map(function (p) {
                                return { type: "blob", path: p };
                            })
                        };
                    }
                    return r.json();
                }).catch(function () {
                    return {
                        tree: DEFAULT_EXTENSION_FILES.map(function (p) {
                            return { type: "blob", path: p };
                        })
                    };
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
            var baseDir = cleanDirectoryPath(customBaseDir);

            try {
                var req = (typeof window !== "undefined" && typeof window.require === "function")
                    ? window.require
                    : (typeof require === "function" ? require : null);
                if (req) {
                    nodeFs = req("fs");
                    nodePath = req("path");
                }
            } catch (e) {}

            if (!baseDir) {
                try {
                    if (typeof window !== "undefined" && window.__adobe_cep__ && window.__adobe_cep__.getSystemPath) {
                        baseDir = cleanDirectoryPath(window.__adobe_cep__.getSystemPath("extension"));
                    }
                } catch (e) {}
            }

            if (!baseDir) {
                try {
                    if (typeof __dirname !== "undefined") {
                        baseDir = cleanDirectoryPath(__dirname);
                    } else if (nodePath && typeof process !== "undefined" && process.cwd) {
                        baseDir = cleanDirectoryPath(process.cwd());
                    }
                } catch (e) {}
            }

            var hasCepFs = (typeof window !== "undefined" && window.cep && window.cep.fs);

            if (!baseDir || (!nodeFs && !hasCepFs)) {
                onComplete({
                    success: false,
                    message: "Automatic disk write not available in current environment. Please install from GitHub."
                });
                return;
            }

            var total = files.length;

            function saveFile(relPath, content) {
                var written = false;

                if (nodeFs && nodePath && baseDir) {
                    try {
                        var targetFilePath = nodePath.resolve(baseDir, relPath);
                        var targetDir = nodePath.dirname(targetFilePath);
                        if (!nodeFs.existsSync(targetDir)) {
                            nodeFs.mkdirSync(targetDir, { recursive: true });
                        }
                        nodeFs.writeFileSync(targetFilePath, content, "utf8");
                        written = true;
                    } catch (fsErr) {
                        console.error("nodeFs write error on " + relPath + ":", fsErr);
                    }
                }

                if (!written && hasCepFs && baseDir) {
                    try {
                        var normPath = baseDir + "/" + relPath.replace(/^\/+/, "");
                        var lastSlash = normPath.lastIndexOf("/");
                        if (lastSlash > 0) {
                            var dirPath = normPath.substring(0, lastSlash);
                            window.cep.fs.makedir(dirPath);
                        }
                        var res = window.cep.fs.writeFile(normPath, content);
                        if (res && res.err === 0) {
                            written = true;
                        } else {
                            console.error("cep.fs write error on " + relPath + ": code " + (res ? res.err : "null"));
                        }
                    } catch (cepErr) {
                        console.error("cep.fs exception on " + relPath + ":", cepErr);
                    }
                }

                return written;
            }

            function downloadNext(index) {
                if (index >= files.length) {
                    onProgress("Updated all " + total + " files! Restarting panel...");
                    setTimeout(function () {
                        onComplete({ success: true, count: total });
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
                    var ok = saveFile(item.path, content);
                    if (!ok) {
                        throw new Error("Failed to write " + item.path + " to disk (Permission or path error). Update stopped.");
                    }
                    downloadNext(index + 1);
                })
                .catch(function (err) {
                    // Try falling back to main branch for raw URL if tag failed
                    var fallbackUrl = "https://raw.githubusercontent.com/" + repo + "/main/" + item.path + "?t=" + Date.now();
                    fetch(fallbackUrl)
                    .then(function (fbRes) {
                        if (!fbRes.ok) throw new Error("Could not download " + item.path);
                        return fbRes.text();
                    })
                    .then(function (content) {
                        var ok = saveFile(item.path, content);
                        if (!ok) {
                            throw new Error("Failed to write " + item.path + " to disk. Update stopped.");
                        }
                        downloadNext(index + 1);
                    })
                    .catch(function (fbErr) {
                        onComplete({ success: false, message: fbErr.message });
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
        openDownloadPage: openDownloadPage,
        DEFAULT_EXTENSION_FILES: DEFAULT_EXTENSION_FILES
    };
}));
