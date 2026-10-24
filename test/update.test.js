const test = require('node:test');
const assert = require('node:assert/strict');
const HaymUpdater = require('../js/update.js');

test('HaymUpdater version comparison and configuration', async (t) => {
    await t.test('compareVersions identifies newer versions correctly', () => {
        assert.equal(HaymUpdater.compareVersions('1.1.0', '1.0.0'), 1);
        assert.equal(HaymUpdater.compareVersions('1.0.1', '1.0.0'), 1);
        assert.equal(HaymUpdater.compareVersions('2.0.0', '1.9.9'), 1);
        assert.equal(HaymUpdater.compareVersions('v1.2.0', '1.0.0'), 1);
        assert.equal(HaymUpdater.compareVersions('1.0.0', '1.0.0'), 0);
        assert.equal(HaymUpdater.compareVersions('0.9.0', '1.0.0'), -1);
    });

    await t.test('Defaults and constant versions are defined', () => {
        assert.equal(HaymUpdater.CURRENT_VERSION, '1.4.1');
        assert.ok(HaymUpdater.DEFAULT_REPO.length > 0);
    });
});
