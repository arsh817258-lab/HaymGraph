const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('ExtendScript files are syntactically valid JavaScript', () => {
    const hostPath = path.join(__dirname, '..', 'jsx', 'host.jsx');
    const hostCode = fs.readFileSync(hostPath, 'utf8');
    assert.doesNotThrow(() => {
        new Function(hostCode);
    }, 'host.jsx should be valid JS syntax');

    const json2Path = path.join(__dirname, '..', 'jsx', 'json2.js');
    const json2Code = fs.readFileSync(json2Path, 'utf8');
    assert.doesNotThrow(() => {
        new Function(json2Code);
    }, 'json2.js should be valid JS syntax');
});
