const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const server = require('../server.js');

let testPort = 0;
let testServer = null;

function fetchUrl(path) {
    return new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${testPort}${path}`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
        }).on('error', reject);
    });
}

test('Local server serves all web app assets correctly', async (t) => {
    // Start ephemeral server for testing
    await new Promise((resolve) => {
        testServer = server.listen(0, '127.0.0.1', () => {
            testPort = testServer.address().port;
            resolve();
        });
    });

    t.after(() => {
        if (testServer) testServer.close();
    });

    await t.test('GET / (index.html)', async () => {
        const res = await fetchUrl('/');
        assert.equal(res.status, 200);
        assert.ok(res.body.includes('<title>HaymGraph</title>'));
        assert.ok(res.body.includes('curve-box-container'));
        assert.ok(res.body.includes('overshoot-modal'));
        // Verify only icon buttons remain
        assert.ok(res.body.includes('id="btn-apply"'));
        assert.ok(res.body.includes('id="btn-analyze"'));
        assert.ok(res.body.includes('id="btn-reverse"'));
        assert.ok(!res.body.includes('id="btn-flatten"'));
        assert.ok(!res.body.includes('id="btn-ease"'));
        assert.ok(res.body.includes('settings-modal'));
        assert.ok(!res.body.includes('readout-card'));
        assert.ok(!res.body.includes('toast-container'));
    });

    await t.test('GET /css/style.css', async () => {
        const res = await fetchUrl('/css/style.css');
        assert.equal(res.status, 200);
        assert.ok(res.body.includes('.haym-curve-canvas'));
        assert.ok(res.body.includes('--accent-cyan'));
        assert.ok(res.body.includes('.action-toolbar'));
        assert.ok(res.body.includes('.settings-form'));
    });

    await t.test('GET /js/coreMath.js', async () => {
        const res = await fetchUrl('/js/coreMath.js');
        assert.equal(res.status, 200);
        assert.ok(res.body.includes('bezierToEase'));
        assert.ok(res.body.includes('computeCurveExtrema'));
    });

    await t.test('GET /js/update.js', async () => {
        const res = await fetchUrl('/js/update.js');
        assert.equal(res.status, 200);
        assert.ok(res.body.includes('HaymUpdater'));
        assert.ok(res.body.includes('checkForUpdates'));
    });

    await t.test('GET /js/curveBox.js', async () => {
        const res = await fetchUrl('/js/curveBox.js');
        assert.equal(res.status, 200);
        assert.ok(res.body.includes('CurveBox'));
        assert.ok(res.body.includes('flattenHandle'));
    });

    await t.test('GET /js/csInterface.js', async () => {
        const res = await fetchUrl('/js/csInterface.js');
        assert.equal(res.status, 200);
        assert.ok(res.body.includes('CSInterface'));
    });

    await t.test('GET /js/app.js', async () => {
        const res = await fetchUrl('/js/app.js');
        assert.equal(res.status, 200);
        assert.ok(res.body.includes('onSeparateAndApply'));
        assert.ok(res.body.includes('HaymUpdater'));
    });
});
