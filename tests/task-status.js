'use strict';
// All Android paths below are keys in memory; no device or game APIs are loaded.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/task-status.js'), 'utf8');
const FILE = '/sdcard/Download/autosgs-logs/task-status.json';
const plain = value => JSON.parse(JSON.stringify(value));
function harness(options = {}) {
    const memory = options.memory || new Map(), writes = [], warnings = [], reads = [];
    let time = 10000;
    const locking = { locks: 0, unlocks: 0, depth: 0, maxDepth: 0 };
    function underLock() { if (options.lock) assert.ok(locking.depth > 0, 'storage access must hold model lock'); }
    function ReentrantLock() {}
    ReentrantLock.prototype.lock = function () { locking.locks++; locking.depth++; locking.maxDepth = Math.max(locking.maxDepth, locking.depth); };
    ReentrantLock.prototype.unlock = function () { assert.ok(locking.depth > 0); locking.unlocks++; locking.depth--; };
    function Clock() { this.getTime = () => time; }
    function File(name) { this.name = String(name); }
    File.prototype.getCanonicalPath = function () {
        return options.canonical ? options.canonical(this.name) : this.name.replace('/sdcard/', '/storage/emulated/0/');
    };
    File.prototype.renameTo = function (target) {
        underLock(); assert.equal(this.name, FILE + '.tmp'); assert.equal(target.name, FILE);
        if (options.renameFailure) return false;
        memory.set(target.name, memory.get(this.name)); memory.delete(this.name); return true;
    };
    const context = { Date: Clock, sgs: { log: { w: value => warnings.push(value) } } };
    if (!options.noFiles) context.files = {
        exists(name) { underLock(); assert.equal(name, FILE); return memory.has(name); },
        read(name) { underLock(); reads.push(name); if (options.readFailure) throw Error('read failed'); return memory.get(name); },
        ensureDir(name) { underLock(); assert.equal(name, '/sdcard/Download/autosgs-logs/'); },
        write(name, text) { underLock(); assert.equal(name, FILE + '.tmp'); writes.push(name); if (options.writeFailure) throw Error('write failed'); memory.set(name, text); }
    };
    if (!options.noJava) context.java = { io: { File } };
    if (options.lock) context.java.util = { concurrent: { locks: { ReentrantLock } } };
    vm.runInNewContext(source, context, { filename: 'src/task-status.js' });
    return { status: context.sgs.taskStatus, memory, writes, warnings, reads, locking, tick(ms) { time += ms; } };
}
let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log('ok - ' + name); }
    catch (e) { failed++; console.error('not ok - ' + name + '\n' + e.stack); }
}
function begin(h, token = {}, id = 'daily') { h.status.begin(token, { id, label: '日常' }); return token; }
test('module is lazy and missing files/java use memory', () => {
    for (const opts of [{}, { noFiles: true }, { noJava: true }, { noFiles: true, noJava: true }]) {
        const h = harness(opts); assert.equal(h.reads.length, 0); assert.equal(h.writes.length, 0);
        assert.equal(h.status.current(), null); const token = begin(h); assert.equal(h.status.current().status, 'running');
        assert.equal(h.status.finish(token, 'success', '完成').status, 'success');
        if (opts.noFiles || opts.noJava) assert.equal(h.writes.length, 0);
    }
});
test('old token cannot progress or finish a new run; tokens never serialize', () => {
    const h = harness(), a = { secret: 'TOKEN-SECRET' }, b = {};
    begin(h, a); const first = h.status.current().runId; begin(h, b);
    assert.notEqual(first, h.status.current().runId);
    assert.equal(h.status.step(a, 'bad', 'bad'), false); assert.equal(h.status.finish(a, 'success', 'bad'), false);
    assert.equal(h.status.current().message, ''); assert.ok(!h.memory.get(FILE).includes('TOKEN-SECRET'));
    h.status.finish(b, 'success', '完成'); assert.equal(h.status.history().length, 1);
});
test('stop survives all late progress and only stopped can end; finish is idempotent', () => {
    const h = harness(), token = begin(h);
    assert.equal(h.status.stopping(token), true);
    assert.equal(h.status.step(token, 'running', '迟到'), false); assert.equal(h.status.finishing(token, '迟到'), false);
    assert.equal(h.status.finish(token, 'success', '迟到'), false);
    assert.equal(h.status.current().status, 'stopping');
    assert.equal(h.status.finish(token, 'stopped', '用户停止').status, 'stopped');
    assert.equal(h.status.finish(token, 'stopped', '重复'), false); assert.equal(h.status.history().length, 1);
});
test('elapsed time is live until finish then frozen; Chinese title and detail', () => {
    const h = harness(), token = begin(h); h.tick(1250);
    assert.equal(h.status.current().durationMs, 1250); assert.equal(h.status.title(), '运行中·日常');
    h.status.step(token, 'recovery'); assert.ok(h.status.detail().includes('恢复主城'));
    h.status.finishing(token, '确认结果'); assert.equal(h.status.title(), '收尾中·日常');
    assert.ok(h.status.detail().includes('1.3 秒'));
    h.status.finish(token, 'success', '完成'); h.tick(5000);
    assert.equal(h.status.current().durationMs, 1250); assert.ok(h.status.detail().includes('1.3 秒')); assert.equal(h.status.title(), '成功·日常');
});
test('terminal statuses and deep clones including input item results', () => {
    const h = harness();
    for (const status of ['success', 'skipped', 'unconfirmed', 'failed', 'stopped']) {
        const token = begin(h), items = [{ id: 'mail', result: { status: 'success' } }];
        const result = h.status.finish(token, status, '原因', items); items[0].result.status = 'bad'; result.items[0].id = 'bad';
        const current = h.status.current(), history = h.status.history(); current.items[0].result.status = 'bad'; history[0].items[0].id = 'bad';
        assert.equal(h.status.current().items[0].id, 'mail'); assert.equal(h.status.current().items[0].result.status, 'success');
        assert.equal(h.status.current().status, status);
    }
});
test('history bounds at twenty newest first and completed runs reload', () => {
    const h = harness();
    for (let i = 0; i < 25; i++) { const token = begin(h, {}, String(i)); h.status.finish(token, 'success', String(i)); }
    assert.equal(h.status.history().length, 20); assert.deepEqual(plain(h.status.history().map(r => r.id)), Array.from({ length: 20 }, (_, i) => String(24 - i)));
    const restarted = harness({ memory: h.memory }); assert.equal(restarted.status.current().id, '24'); assert.equal(restarted.status.history().length, 20);
    assert.equal(JSON.parse(h.memory.get(FILE)).active, null);
});
test('persist active and restart as unconfirmed once, clear active, never resume tasks', () => {
    const h = harness(), token = begin(h); h.tick(250); h.status.step(token, 'recovery', '恢复');
    assert.equal(JSON.parse(h.memory.get(FILE)).active.phase, 'recovery');
    const restarted = harness({ memory: h.memory }), current = restarted.status.current();
    assert.equal(current.status, 'unconfirmed'); assert.ok(current.message.includes('没有结束记录'));
    assert.equal(restarted.status.history().length, 1); assert.equal(JSON.parse(h.memory.get(FILE)).active, null);
    assert.equal(restarted.status.step(token, 'bad'), false);
    assert.equal(harness({ memory: h.memory }).status.history().length, 1);
});
for (const suffix of ['', '.tmp']) test('canonical symlink guard fails closed for ' + (suffix || 'target'), () => {
    const memory = new Map([[FILE, '{old}']]);
    const h = harness({ memory, canonical: name => name === FILE + suffix ? '/outside/file' : name.replace('/sdcard/', '/storage/emulated/0/') });
    const token = begin(h); h.status.finish(token, 'success', '完成');
    assert.equal(h.writes.length, 0); assert.equal(h.reads.length, 0); assert.equal(memory.get(FILE), '{old}'); assert.ok(h.warnings.length);
});
for (const failure of ['renameFailure', 'writeFailure', 'readFailure']) test(failure + ' warns without hiding business result or removing old file', () => {
    const initial = harness(); const token = begin(initial); initial.status.finish(token, 'success', '旧记录');
    const old = initial.memory.get(FILE), h = harness({ memory: initial.memory, [failure]: true });
    const next = begin(h); assert.equal(h.status.finish(next, 'failed', '业务错误').message, '业务错误');
    if (failure !== 'readFailure') assert.equal(h.memory.get(FILE), old);
    assert.ok(h.warnings.length);
});
for (const text of ['{broken', 'null', '{"version":2,"active":null,"history":[]}', '{"version":1,"active":{},"history":[]}', '{"version":1,"active":null,"history":[{}]}']) test('corrupt persisted data is inert: ' + text, () => {
    const h = harness({ memory: new Map([[FILE, text]]) });
    assert.equal(h.status.current(), null); assert.equal(h.status.history().length, 0); assert.equal(h.writes.length, 0); assert.ok(h.warnings.length);
    const token = begin(h); assert.equal(h.status.finish(token, 'success', '新任务').status, 'success');
});
test('invalid finish cannot mutate active and null tokens cannot own a run', () => {
    const h = harness(); assert.equal(h.status.begin(null, { id: 'daily', label: '日常' }), false);
    const token = begin(h); assert.equal(h.status.finish(token, 'bogus', ''), false);
    assert.equal(h.status.finish(token, 'success', '', {}), false); assert.equal(h.status.current().status, 'running');
});
test('all public operations and persistence hold one balanced reentrant lock', () => {
    const h = harness({ lock: true }), token = begin(h);
    const check = fn => {
        const before = h.locking.locks;
        fn(); assert.ok(h.locking.locks > before); assert.equal(h.locking.depth, 0); assert.equal(h.locking.locks, h.locking.unlocks);
    };
    check(() => h.status.current()); check(() => h.status.history());
    check(() => h.status.title()); check(() => h.status.detail());
    assert.equal(h.locking.maxDepth, 2, 'title/detail -> current must reenter the same lock');
    check(() => h.status.step(token, 'recovery')); check(() => h.status.finishing(token));
    check(() => h.status.stopping(token)); check(() => h.status.step(token, 'late'));
    check(() => h.status.finish(token, 'stopped', '已停止')); check(() => h.status.finish(token, 'stopped', '重复'));
    check(() => begin(h));
    const restarted = harness({ lock: true, memory: h.memory }); restarted.status.current();
    assert.equal(restarted.status.current().status, 'unconfirmed');
    assert.equal(restarted.locking.locks, restarted.locking.unlocks);
});
test('lock unlocks on thrown public operation and swallowed storage error', () => {
    const h = harness({ lock: true, writeFailure: true }), token = begin(h);
    assert.ok(h.warnings.length); assert.equal(h.locking.locks, h.locking.unlocks);
    const bad = { get status() { throw Error('bad record'); } };
    assert.throws(() => h.status.title(bad), /bad record/);
    assert.equal(h.locking.depth, 0); assert.equal(h.locking.locks, h.locking.unlocks);
    assert.equal(h.status.stopping(token), true); assert.equal(h.status.finish(token, 'stopped', '结束').status, 'stopped');
    assert.equal(h.locking.locks, h.locking.unlocks);
});
console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
