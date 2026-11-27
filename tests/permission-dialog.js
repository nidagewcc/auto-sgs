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
let retryAssertions = 0;
function check(actual, expected) { assert.deepEqual(actual, expected); retryAssertions++; }
for (const scenario of [
    { results: [false, true], ok: true, requests: 2, errors: 0 },
    { results: [false, false, false], ok: false, requests: 3, errors: 1 },
    { results: [new Error('capture timeout'), new Error('capture timeout'), new Error('capture timeout')], ok: false, requests: 3, errors: 4 }
]) {
    const calls = { requests: [], sleeps: [], toast: [], warnings: [], errors: [], starts: 0, interrupts: 0 };
    const ctx = {
        sgs: { log: { i() {}, w(m) { calls.warnings.push(m); }, e(m) { calls.errors.push(m); } } },
        threads: { start() { calls.starts++; return { interrupt() { calls.interrupts++; } }; } },
        requestScreenCapture(land) {
            const result = scenario.results[calls.requests.length];
            calls.requests.push(land);
            if (result instanceof Error) throw result;
            return result;
        },
        device: { width: 1280, height: 2772 },
        sleep(ms) { calls.sleeps.push(ms); }, toast(m) { calls.toast.push(m); }, log() {}
    };
    vm.runInNewContext(fs.readFileSync('src/vision.js', 'utf8'), ctx);
    ctx.sgs.vision._landForce = true;
    check(ctx.sgs.vision.init(), scenario.ok);
    check(ctx.sgs.vision._capOk, scenario.ok);
    check(calls.requests, Array(scenario.requests).fill(true));
    check(calls.starts, scenario.requests);
    check(calls.interrupts, scenario.requests);
    check(calls.toast, ['截图权限未授予，请把 AutoJs6 切到前台']);
    check(calls.warnings.length, 1);
    check(calls.warnings[0], '[vision] ' + calls.toast[0]);
    check(calls.errors.length, scenario.errors);
    check(calls.sleeps.filter(ms => ms === 800).length, scenario.requests - 1);
    check(calls.sleeps.filter(ms => ms === 500).length, scenario.ok ? 1 : 0);
    if (!scenario.ok) check(calls.errors.at(-1), '[vision] 截图权限申请3次均失败');
    if (scenario.ok) {
        check(ctx.sgs.vision.init(), true);
        check(calls.requests.length, scenario.requests);
    }
}
console.log('permission-dialog: 2 scoped SystemUI tests + 3 retry paths (' + retryAssertions + ' retry assertions) passed');
