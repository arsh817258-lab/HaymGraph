const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Quick Action Tools (Editing Jesus Zenmen Mode)', async (t) => {
    await t.test('index.html contains zenmen mode toggle, tool options grid, and all action buttons', () => {
        const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

        // Mode name and settings toggle
        assert.ok(html.includes('editing jesus zenmen mode'), 'index.html must display "editing jesus zenmen mode"');
        assert.ok(html.includes('id="setting-quick-tools-toggle"'), 'index.html must have #setting-quick-tools-toggle');
        assert.ok(html.includes('id="setting-quick-tools-options"'), 'index.html must have #setting-quick-tools-options');
        assert.ok(html.includes('class="zenmen-tools-grid"'), 'index.html must have .zenmen-tools-grid');

        // Quick Tools Toolbar and buttons
        assert.ok(html.includes('id="quick-tools-bar"'), 'index.html must have #quick-tools-bar');
        assert.ok(html.includes('id="btn-quick-adj"'), 'index.html must have #btn-quick-adj');
        assert.ok(html.includes('id="btn-quick-null"'), 'index.html must have #btn-quick-null');
        assert.ok(html.includes('id="btn-quick-third"'), 'index.html must have #btn-quick-third');
        assert.ok(html.includes('id="btn-quick-solid"'), 'index.html must have #btn-quick-solid');
        assert.ok(html.includes('id="btn-quick-precomp"'), 'index.html must have #btn-quick-precomp');
        assert.ok(html.includes('id="btn-quick-camera"'), 'index.html must have #btn-quick-camera');
        assert.ok(html.includes('id="btn-quick-loop"'), 'index.html must have #btn-quick-loop');
        assert.ok(html.includes('id="btn-quick-split"'), 'index.html must have #btn-quick-split');

        // Verify quick-tools-bar has initial hidden class
        assert.ok(html.includes('class="quick-tools-bar hidden"'), 'quick tools bar should start hidden');
    });

    await t.test('style.css defines styling for zenmen toolbar and tools grid', () => {
        const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');
        assert.ok(css.includes('.quick-tools-bar'), 'css must define .quick-tools-bar');
        assert.ok(css.includes('.quick-tools-bar.hidden'), 'css must define .quick-tools-bar.hidden');
        assert.ok(css.includes('.quick-tool-btn'), 'css must define .quick-tool-btn');
        assert.ok(css.includes('.setting-zenmen-box'), 'css must define .setting-zenmen-box');
        assert.ok(css.includes('.zenmen-tools-grid'), 'css must define .zenmen-tools-grid');
    });

    await t.test('host.jsx implements topmost placement, autotrim, and exports all functions', () => {
        const hostJsx = fs.readFileSync(path.join(__dirname, '..', 'jsx', 'host.jsx'), 'utf8');

        // Verify placement & autotrim helper functions
        assert.ok(hostJsx.includes('function getSelectedLayersBounds('), 'host.jsx must implement getSelectedLayersBounds');
        assert.ok(hostJsx.includes('function applyBoundsAndPlacement('), 'host.jsx must implement applyBoundsAndPlacement');

        // Verify functions are implemented
        assert.ok(hostJsx.includes('function addAdjustmentLayer('), 'host.jsx must implement addAdjustmentLayer');
        assert.ok(hostJsx.includes('function addCenterNull('), 'host.jsx must implement addCenterNull');
        assert.ok(hostJsx.includes('function getLayerCenterCoord('), 'host.jsx must implement getLayerCenterCoord');
        assert.ok(hostJsx.includes('function centerAnchorPoint('), 'host.jsx must implement centerAnchorPoint');
        assert.ok(hostJsx.includes('function toggleLoopKeyframes('), 'host.jsx must implement toggleLoopKeyframes');
        assert.ok(hostJsx.includes('function addCameraRig('), 'host.jsx must implement addCameraRig');
        assert.ok(hostJsx.includes('function smartPrecompose('), 'host.jsx must implement smartPrecompose');
        assert.ok(hostJsx.includes('function addSolidLayer('), 'host.jsx must implement addSolidLayer');
        assert.ok(hostJsx.includes('function splitLayersAtPlayhead('), 'host.jsx must implement splitLayersAtPlayhead');

        // Verify exports in return object
        assert.ok(hostJsx.includes('addAdjustmentLayer: addAdjustmentLayer'), 'host.jsx must export addAdjustmentLayer');
        assert.ok(hostJsx.includes('addCenterNull: addCenterNull'), 'host.jsx must export addCenterNull');
        assert.ok(hostJsx.includes('centerAnchorPoint: centerAnchorPoint'), 'host.jsx must export centerAnchorPoint');
        assert.ok(hostJsx.includes('toggleLoopKeyframes: toggleLoopKeyframes'), 'host.jsx must export toggleLoopKeyframes');
        assert.ok(hostJsx.includes('addCameraRig: addCameraRig'), 'host.jsx must export addCameraRig');
        assert.ok(hostJsx.includes('smartPrecompose: smartPrecompose'), 'host.jsx must export smartPrecompose');
        assert.ok(hostJsx.includes('addSolidLayer: addSolidLayer'), 'host.jsx must export addSolidLayer');
        assert.ok(hostJsx.includes('splitLayersAtPlayhead: splitLayersAtPlayhead'), 'host.jsx must export splitLayersAtPlayhead');
    });

    await t.test('csInterface mock responds to quick tool evalScript queries', async () => {
        const CSInterface = require('../js/csInterface.js');
        const csi = new CSInterface();

        const testCalls = [
            { script: 'HaymHost.addAdjustmentLayer()', key: 'name' },
            { script: 'HaymHost.addCenterNull()', key: 'name' },
            { script: 'HaymHost.centerAnchorPoint()', key: 'count' },
            { script: 'HaymHost.toggleLoopKeyframes()', key: 'count' },
            { script: 'HaymHost.addCameraRig()', key: 'success' },
            { script: 'HaymHost.smartPrecompose()', key: 'name' },
            { script: 'HaymHost.addSolidLayer(1, 1, 1)', key: 'name' },
            { script: 'HaymHost.splitLayersAtPlayhead()', key: 'count' }
        ];

        for (const tc of testCalls) {
            await new Promise((resolve) => {
                csi.evalScript(tc.script, (resStr) => {
                    const res = JSON.parse(resStr);
                    assert.equal(res.success, true);
                    assert.ok(res[tc.key] !== undefined);
                    resolve();
                });
            });
        }
    });

    await t.test('app.js includes zenmen tools handlers, toggles, and state restoration', () => {
        const appJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
        assert.ok(appJs.includes('btnQuickAdj'), 'app.js must reference btnQuickAdj');
        assert.ok(appJs.includes('btnQuickNull'), 'app.js must reference btnQuickNull');
        assert.ok(appJs.includes('btnQuickThird'), 'app.js must reference btnQuickThird');
        assert.ok(appJs.includes('btnQuickSolid'), 'app.js must reference btnQuickSolid');
        assert.ok(appJs.includes('btnQuickPrecomp'), 'app.js must reference btnQuickPrecomp');
        assert.ok(appJs.includes('btnQuickCamera'), 'app.js must reference btnQuickCamera');
        assert.ok(appJs.includes('btnQuickLoop'), 'app.js must reference btnQuickLoop');
        assert.ok(appJs.includes('btnQuickSplit'), 'app.js must reference btnQuickSplit');
        assert.ok(appJs.includes('setQuickToolsEnabled'), 'app.js must implement setQuickToolsEnabled');
        assert.ok(appJs.includes('updateZenmenToolbarButtons'), 'app.js must implement updateZenmenToolbarButtons');
        assert.ok(appJs.includes('setZenmenToolActive'), 'app.js must implement setZenmenToolActive');
        assert.ok(appJs.includes('haymgraph_zenmen_tools'), 'app.js must save haymgraph_zenmen_tools');
    });
});

