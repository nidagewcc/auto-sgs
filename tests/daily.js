'use strict';
// Host-only runner tests. Android paths exist only as keys in an in-memory Map.
// No task implementation, recovery implementation, device API, or real write is loaded.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/daily.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const selected = (...ids) => ids.map(id => ({ id, enabled: true }));
const success = () => ({ status: 'success', message: 'confirmed' });
function harness(options = {}) {
    const memory = new Map(), calls = { tasks: [], recovery: [], writes: [], renames: [], warnings: [], progress: [] };
    let cancelled = false, interrupted = false;
    const h = { memory, calls, cancel() { cancelled = true; }, interrupt() { interrupted = true; } };
    function File(name) { this.name = String(name); }
    File.prototype.getCanonicalPath = function () {
        return options.canonical ? options.canonical(this.name) : this.name.replace('/sdcard/', '/storage/emulated/0/');
    };
    File.prototype.renameTo = function (target) {
        calls.renames.push([this.name, target.name]);
        if (options.renameFailure && options.renameFailure(target.name)) return false;
        assert.ok(memory.has(this.name), 'rename source must have been written in memory');
        memory.set(target.name, memory.get(this.name)); memory.delete(this.name); return true;
    };
    const sgs = { log: { i() {}, e() {}, w(message) { calls.warnings.push(message); } }, tasks: {},
        ui: { isBusy: () => !!options.busy },
        dailyRecovery: { ensureHome(lastId, callback, initial) {
            assert.equal(typeof callback, 'function'); assert.equal(typeof initial, 'boolean');
            calls.recovery.push({ lastId, initial });
            return options.recovery ? options.recovery(h, lastId, callback, initial) : true;
        } }
    };
    const context = vm.createContext({ sgs, files: {
        exists: name => memory.has(name),
        read(name) { assert.ok(memory.has(name)); return memory.get(name); },
        ensureDir(name) { assert.equal(name, '/sdcard/Download/autosgs-logs/'); },
        write(name, text) { calls.writes.push(name); if (options.writeFailure) throw new Error('simulated write failure'); memory.set(name, text); }
    }, java: { io: { File }, lang: { Thread: { currentThread: () => ({ isInterrupted: () => interrupted }) } } } });
    vm.runInContext(source, context, { filename: 'src/daily.js' });
    h.s = sgs; h.daily = sgs.daily;
    for (const entry of sgs.daily.CATALOG) sgs.tasks[entry.id] = { run(arg) {
        calls.tasks.push({ id: entry.id, arg: plain(arg === undefined ? null : arg) });
        return options.tasks && options.tasks[entry.id] ? options.tasks[entry.id](h, arg) : success();
    } };
    h.seed = items => memory.set(sgs.daily.FILE, JSON.stringify({ version: 1, items }));
    h.run = () => sgs.daily.run({ isCancelled: () => cancelled, onProgress: (i, total, item) => calls.progress.push([i, total, item.id]) });
    return h;
}
let passed = 0;
const failures = [];
function test(name, fn) {
    try { fn(); passed++; console.log('ok - ' + name); }
    catch (error) { failures.push(name); console.error('not ok - ' + name + '\n' + error.stack); }
}
const ids = h => h.calls.tasks.map(t => t.id);
const statuses = report => report.items.map(item => item.status);

test('default plan runs only mail then xiaoqiao', () => {
    const h = harness(), report = h.run(); assert.deepEqual(ids(h), ['mail', 'xiaoqiao']);
    assert.equal(report.counts.success, 2); assert.deepEqual(plain(h.calls.recovery), [
        { lastId: null, initial: true }, { lastId: 'mail', initial: false },
        { lastId: 'mail', initial: false }, { lastId: 'xiaoqiao', initial: false }]);
});
test('save/load preserves switches and order; omitted tasks are disabled', () => {
    const h = harness(); h.daily.savePlan([{ id: 'zhuxian', enabled: true }, { id: 'mail', enabled: false }, { id: 'junqing', enabled: true }]);
    const loaded = plain(h.daily.loadPlan()); assert.deepEqual(loaded.slice(0, 3), [{ id: 'zhuxian', enabled: true }, { id: 'mail', enabled: false }, { id: 'junqing', enabled: true }]);
    assert.ok(loaded.slice(3).every(item => item.enabled === false)); h.run(); assert.deepEqual(ids(h), ['zhuxian', 'junqing']);
});
for (const [name, value] of Object.entries({ duplicate: selected('mail', 'mail'), unknown: selected('bogus'), stringSwitch: [{ id: 'mail', enabled: 'true' }], missingSwitch: [{ id: 'mail' }], nullItem: [null], nonArray: {} })) {
    test('reject invalid plan: ' + name, () => {
        const h = harness(); assert.throws(() => h.daily.savePlan(value)); assert.equal(h.calls.writes.length, 0);
        h.seed(value); assert.throws(() => h.run()); assert.deepEqual(ids(h), []); assert.equal(h.calls.recovery.length, 0);
    });
}
for (const raw of ['{broken', '{"version":2,"items":[]}', 'null']) test('corrupt configuration never executes defaults: ' + raw, () => {
    const h = harness(); h.memory.set(h.daily.FILE, raw); assert.throws(() => h.run()); assert.deepEqual(ids(h), []);
});
for (const suffix of ['', '.tmp']) test('reject configuration path symlink ' + (suffix || 'target'), () => {
    const h = harness({ canonical: name => name.endsWith('daily-plan.json' + suffix) ? '/elsewhere/plan' : name.replace('/sdcard/', '/storage/emulated/0/') });
    h.seed(selected('mail')); assert.throws(() => h.daily.loadPlan()); assert.throws(() => h.daily.savePlan([])); assert.equal(h.calls.writes.length, 0);
});
test('failed atomic rename preserves old configuration', () => {
    const h = harness({ renameFailure: name => name.endsWith('daily-plan.json') }); h.seed(selected('mail'));
    const old = h.memory.get(h.daily.FILE); assert.throws(() => h.daily.savePlan(selected('xiaoqiao'))); assert.equal(h.memory.get(h.daily.FILE), old);
});
test('busy runner rejects plan saving', () => { const h = harness({ busy: true }); assert.throws(() => h.daily.savePlan([])); assert.equal(h.calls.writes.length, 0); });
test('empty plan calls neither recovery nor task', () => {
    const h = harness(); h.seed([]); const r = h.run(); assert.equal(r.status, 'empty'); assert.equal(h.calls.recovery.length, 0); assert.deepEqual(ids(h), []);
});
test('execution order, progress and success/skipped/unconfirmed/exception counts', () => {
    const h = harness({ tasks: { mail: () => ({ status: 'skipped', message: 'nothing' }), junqing: () => undefined, playerinfo: () => { throw new Error('OCR failed'); } } });
    h.seed(selected('mail', 'junqing', 'playerinfo', 'zhuxian')); const r = h.run();
    assert.deepEqual(ids(h), ['mail', 'junqing', 'playerinfo', 'zhuxian']); assert.deepEqual(plain(statuses(r)), ['skipped', 'unconfirmed', 'failed', 'success']);
    assert.deepEqual(plain(r.counts), { success: 1, skipped: 1, unconfirmed: 1, failed: 1, not_run: 0, cancelled: 0 });
    assert.deepEqual(h.calls.progress, [[1, 4, 'mail'], [2, 4, 'junqing'], [3, 4, 'playerinfo'], [4, 4, 'zhuxian']]);
});
test('xiaoqiao skipped continues daily and counts as skipped', () => {
    const h = harness({ tasks: { xiaoqiao: () => ({ status: 'skipped', message: '开启后 60 秒无执行信号，按官方新规则判定今日已完成并跳过' }) } });
    h.seed(selected('xiaoqiao', 'mail'));
    const r = h.run();
    assert.deepEqual(ids(h), ['xiaoqiao', 'mail']);
    assert.deepEqual(plain(statuses(r)), ['skipped', 'success']);
    assert.equal(r.counts.skipped, 1);
    assert.equal(r.counts.failed, 0);
    assert.equal(r.aborted, false);
});
test('mail failure recovers and continues without retry', () => {
    const h = harness({ tasks: { mail: () => { throw new Error('mail failed'); } } }); const r = h.run();
    assert.deepEqual(ids(h), ['mail', 'xiaoqiao']); assert.deepEqual(plain(statuses(r)), ['failed', 'success']); assert.equal(r.items[0].homeRecovered, true);
});
test('recovery failure stops remaining tasks and reports original result', () => {
    const h = harness({ recovery: (h, last, cb, initial) => initial }); const r = h.run();
    assert.deepEqual(ids(h), ['mail']); assert.deepEqual(plain(statuses(r)), ['failed', 'not_run']); assert.equal(r.items[0].resultBeforeRecovery, 'success'); assert.equal(r.aborted, true); assert.equal(r.counts.not_run, 1);
});
test('initial recovery failure performs no task', () => {
    const h = harness({ recovery: () => false }); const r = h.run(); assert.deepEqual(ids(h), []); assert.equal(r.counts.not_run, 2); assert.equal(r.aborted, true);
});
test('recovery exception stops remaining tasks', () => {
    const h = harness({ recovery: (h, last, cb, initial) => { if (!initial) throw new Error('recovery error'); return true; } });
    const r = h.run(); assert.deepEqual(ids(h), ['mail']); assert.equal(r.items[0].status, 'failed'); assert.equal(r.items[1].status, 'not_run');
});
for (const id of ['xiaoqiao', 'zhuxian']) for (const status of ['failed', 'unconfirmed']) test(id + ' ' + status + ' stops even after successful recovery', () => {
    const h = harness({ tasks: { [id]: () => ({ status }) } }); h.seed(selected(id, 'mail')); const r = h.run();
    assert.deepEqual(ids(h), [id]); assert.equal(r.items[0].homeRecovered, true); assert.equal(r.items[1].status, 'not_run'); assert.equal(r.aborted, true);
});
test('daily zhuxian always disables paid reset', () => {
    const h = harness(); h.seed(selected('zhuxian')); h.run(); assert.equal(h.calls.tasks[0].arg.allowReset, false);
});
const validInfo = () => ({ nickname: { value: '测试玩家' }, level: { value: 20 }, combat_power: { value: 1234 }, physical: { value: { current: 0, max: 150 } }, energy: { value: { current: 10, max: 30 } }, sycee: { value: 0 }, jade: { value: 12 } });
test('playerinfo succeeds only with every field present, including valid zero', () => {
    const h = harness({ tasks: { playerinfo: validInfo } }); h.seed(selected('playerinfo')); assert.equal(h.run().items[0].status, 'success');
    for (const field of Object.keys(validInfo())) for (const value of [null, undefined]) {
        const bad = validInfo(); bad[field].value = value; const h = harness({ tasks: { playerinfo: () => bad } }); h.seed(selected('playerinfo')); assert.equal(h.run().items[0].status, 'failed', field);
    }
});
test('playerinfo rejects empty and non-finite field values', () => {
    for (const [field, value] of [['nickname', ''], ['nickname', '   '], ['level', NaN], ['combat_power', Infinity]]) {
        const bad = validInfo(); bad[field].value = value; const h = harness({ tasks: { playerinfo: () => bad } }); h.seed(selected('playerinfo')); assert.equal(h.run().items[0].status, 'failed', field + ': ' + String(value));
    }
});
test('playerinfo rejects malformed numeric and resource fields', () => {
    const invalid = [['level', 0], ['level', 1.5], ['level', '20'], ['combat_power', -1], ['sycee', '0'], ['jade', -1],
        ['physical', { current: -1, max: 150 }], ['physical', { current: 0.5, max: 150 }], ['physical', { current: 1, max: 0 }],
        ['energy', { current: 1, max: Infinity }], ['energy', { current: '1', max: 30 }], ['energy', '1/30']];
    for (const [field, value] of invalid) {
        const bad = validInfo(); bad[field].value = value; const h = harness({ tasks: { playerinfo: () => bad } });
        h.seed(selected('playerinfo')); assert.equal(h.run().items[0].status, 'failed', field + ': ' + JSON.stringify(value));
    }
    const overflow = validInfo(); overflow.physical.value.current = 200;
    const h = harness({ tasks: { playerinfo: () => overflow } }); h.seed(selected('playerinfo')); assert.equal(h.run().items[0].status, 'success');
});
test('task receives live cancellation callback without automatic retry', () => {
    const h = harness({ tasks: { mail: (h, options) => {
        assert.equal(typeof options.checkCancelled, 'function'); options.checkCancelled(); h.cancel();
        assert.throws(() => options.checkCancelled(), error => error.cancelled === true); h.callbackCancelled = true;
        options.checkCancelled();
    } } });
    const r = h.run(); assert.equal(h.callbackCancelled, true); assert.equal(r.status, 'cancelled'); assert.deepEqual(ids(h), ['mail']); assert.equal(r.items[1].status, 'not_run');
});
test('cancellation before execution performs no recovery or task', () => {
    const h = harness(); h.cancel(); const r = h.run(); assert.equal(r.status, 'cancelled'); assert.deepEqual(ids(h), []); assert.equal(h.calls.recovery.length, 0);
});
test('thread interruption cancels before execution', () => { const h = harness(); h.interrupt(); assert.equal(h.run().status, 'cancelled'); assert.deepEqual(ids(h), []); });
test('cancellation after task stops without recovery or retry', () => {
    const h = harness({ tasks: { mail: h => { h.cancel(); return success(); } } }); const r = h.run();
    assert.equal(r.status, 'cancelled'); assert.deepEqual(ids(h), ['mail']); assert.equal(h.calls.recovery.length, 1); assert.deepEqual(plain(statuses(r)), ['cancelled', 'not_run']);
});
test('cancellation during initial recovery prevents first task', () => {
    const h = harness({ recovery: (h, last, cb) => { h.cancel(); assert.equal(cb(), true); return true; } });
    assert.equal(h.run().status, 'cancelled'); assert.deepEqual(ids(h), []); assert.equal(h.calls.recovery.length, 1);
});
test('cancellation during post-task recovery stops without retry', () => {
    const h = harness({ recovery: (h, last, cb, initial) => { if (!initial) { h.cancel(); assert.equal(cb(), true); } return true; } });
    const r = h.run(); assert.equal(r.status, 'cancelled'); assert.deepEqual(ids(h), ['mail']); assert.equal(h.calls.recovery.length, 2); assert.equal(r.items[1].status, 'not_run');
});
test('run keeps its plan snapshot while persisted configuration changes', () => {
    const h = harness({ tasks: { mail: h => { h.seed(selected('zhuxian')); return success(); } } }); const r = h.run();
    assert.deepEqual(ids(h), ['mail', 'xiaoqiao']); assert.deepEqual(plain(r.plan.filter(x => x.enabled).map(x => x.id)), ['mail', 'xiaoqiao']);
    assert.equal(h.daily.loadPlan()[0].id, 'zhuxian');
});
test('finished report is persisted with counts and duration', () => {
    const h = harness(), r = h.run(), saved = JSON.parse(h.memory.get(h.daily.RESULT_FILE));
    assert.deepEqual(saved, plain(r)); assert.ok(r.durationMs >= 0); assert.equal(r.counts.success, 2); assert.ok(h.daily.formatReport(r).includes('成功 2'));
});
test('report rename failure preserves prior report without masking business result', () => {
    const h = harness({ renameFailure: name => name.endsWith('daily-last-result.json') }); h.memory.set(h.daily.RESULT_FILE, 'old-report');
    const r = h.run(); assert.equal(r.status, 'success'); assert.equal(r.counts.success, 2); assert.equal(h.memory.get(h.daily.RESULT_FILE), 'old-report'); assert.equal(h.calls.warnings.length, 1);
});
test('report write failure does not mask failed task result', () => {
    const h = harness({ writeFailure: true, tasks: { mail: () => { throw new Error('business failure'); } } });
    const r = h.run(); assert.equal(r.items[0].status, 'failed'); assert.match(r.items[0].message, /business failure/); assert.equal(r.items[1].status, 'success'); assert.equal(h.calls.warnings.length, 1);
});
test('read-only per-run plan bypasses stored consuming tasks without changing configuration', () => {
    const h = harness({ tasks: { playerinfo: validInfo } });
    h.seed(selected('mail', 'xiaoqiao'));
    const before = h.memory.get(h.daily.FILE);
    const r = h.daily.run({ plan: [{ id: 'playerinfo', enabled: true }] });
    assert.deepEqual(ids(h), ['playerinfo']);
    assert.equal(r.counts.success, 1);
    assert.equal(h.memory.get(h.daily.FILE), before);
});
console.log('\n' + passed + ' passed; ' + failures.length + ' failed');
if (failures.length) process.exitCode = 1;
