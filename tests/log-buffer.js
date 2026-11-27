const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
// Exercise the generated runtime block, including Python template newline decoding.
const bundle = fs.readFileSync('build/bundle.js', 'utf8');
const block = bundle.slice(bundle.indexOf('// ===== 日志与回传 ====='), bundle.indexOf('// ===== src/config.js ====='));
assert(block.includes('var LOG_MEM_MAX = 2000;'));
let assertions = 1;
function check(actual, expected) { assert.deepEqual(actual, expected); assertions++; }
function probe(pc = 'http://desktop', fail = false) {
    const sent = [], local = [];
    let posts = 0;
    const ctx = {
        sgs: { PC: pc }, log() {},
        files: { ensureDir() {}, exists() { return false; }, append(path, value) { local.push(value); } },
        http: { post(url, chunk) { posts++; if (fail) throw new Error('offline'); sent.push(...chunk.split('\n')); } }
    };
    vm.runInNewContext(block, ctx);
    return { ctx, sent, local, posts: () => posts };
}
const lines = (n, offset = 0) => Array.from({ length: n }, (_, i) => '[I] line-' + (offset + i));
{
    const p = probe();
    p.ctx.sgs.log.i('one'); p.ctx.sgs.log.w('two'); p.ctx.sgs.log.e('three');
    p.ctx.sgs.pushLog(); p.ctx.sgs.pushLog();
    check(p.sent, ['[I] one', '[W] two', '[E] three']);
    check(p.posts(), 1);
    check(p.local, p.sent.map(s => s + '\n'));
    check(p.ctx.pushedIdx, 3);
}
{
    const p = probe('');
    for (let i = 0; i < 2500; i++) p.ctx.sgs.log.i('line-' + i);
    check(p.ctx.LOGS.length, 2000);
    check(Array.from(p.ctx.LOGS), lines(2000, 500));
    check(p.ctx.pushedIdx, 0);
    p.ctx.sgs.pushLog();
    check(p.ctx.pushedIdx, 2000);
    check(p.posts(), 0);
    p.ctx.sgs.log.i('last');
    check(p.ctx.pushedIdx, 1999);
    p.ctx.sgs.pushLog();
    check(p.ctx.pushedIdx, 2000);
}
// Online bursts exceed capacity even without a heartbeat; every pending entry must arrive once.
for (const cadence of [0, 137, 2000]) {
    const p = probe();
    for (let i = 0; i < 6500; i++) {
        p.ctx.sgs.log.i('line-' + i);
        if (cadence && (i + 1) % cadence === 0) p.ctx.sgs.pushLog();
        assert(p.ctx.LOGS.length <= 2000);
        assert(p.ctx.pushedIdx >= 0 && p.ctx.pushedIdx <= p.ctx.LOGS.length);
        assertions += 2;
    }
    p.ctx.sgs.pushLog(); p.ctx.sgs.pushLog();
    check(p.sent, lines(6500));
    check(Array.from(p.ctx.LOGS), lines(2000, 4500));
    check(p.ctx.pushedIdx, 2000);
}
{
    const p = probe('http://desktop', true);
    // Full buffer triggers push failure inside the logging call; the warning must not recurse.
    for (let i = 0; i < 2001; i++) p.ctx.sgs.log.i('line-' + i);
    check(p.ctx.pushFail, 1);
    check(p.ctx.LOGS.length, 2000);
    check(p.local.filter(s => s.includes('电脑端日志服务不可达')).length, 1);
    p.ctx.sgs.pushLog(); p.ctx.sgs.log.e('retry'); p.ctx.sgs.pushLog();
    check(p.ctx.pushFail, 3);
    const posts = p.posts();
    for (let i = 0; i < 2200; i++) p.ctx.sgs.log.w('fused-' + i);
    p.ctx.sgs.pushLog();
    check(p.posts(), posts);
    check(p.ctx.LOGS.length, 2000);
}
console.log('log-buffer: bounded/offline/online/fuse checks passed (' + assertions + ' assertions)');
