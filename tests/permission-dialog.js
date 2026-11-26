// Capture authorization helpers must never match a label in a browser/gallery app.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
for (const fallback of [false, true]) {
    const packages = [];
    let helper;
    let approved = 0;
    const selector = (exact) => ({
        packageName(owner) {
            packages.push(owner);
            assert.equal(owner, 'com.android.systemui');
            return { findOnce() { return fallback && exact ? null : { click() { approved++; return true; } }; } };
        }
    });
    const context = {
        sgs: { log: { i() {}, w() {}, e() {} } },
        threads: { start(fn) { helper = fn; return { interrupt() {} }; } },
        requestScreenCapture() { helper(); return true; },
        text: () => selector(true), textContains: () => selector(false), sleep() {}, log() {},
        click() { throw new Error('Unexpected unscoped coordinate click'); }
    };
    vm.runInNewContext(fs.readFileSync('src/vision.js', 'utf8'), context);
    assert.equal(context.sgs.vision._autoGrant(true), true);
    assert.equal(approved, 1);
    assert.equal(packages.length, fallback ? 2 : 1);
}
console.log('permission-dialog: 2 scoped SystemUI authorization tests passed');
