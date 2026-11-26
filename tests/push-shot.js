const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const match = fs.readFileSync('tools/build.py', 'utf8').match(/sgs\.pushShot = function \(\) \{[\s\S]*?\n\};/);
assert(match);
function probe(options = {}) {
    const ctx = { pushFail: options.pushFail || 0,
        sgs: { PC: options.noPC ? '' : 'http://desktop', vision: { frame: () => options.noImage ? null : {} }, log: { w() {} } },
        images: { toBase64: () => 'jpeg' },
        http: { post() { if (options.networkError) throw new Error('offline'); return { statusCode: options.code || 200 }; } } };
    vm.runInNewContext(match[0], ctx);
    return { result: ctx.sgs.pushShot(), reason: ctx.sgs.lastShotError };
}
assert.equal(probe().result, true);
assert.equal(probe({ code: 204 }).result, true);
for (const options of [{ noPC: true }, { pushFail: 3 }, { noImage: true }, { code: 500 }, { networkError: true }]) {
    const value = probe(options); assert.equal(value.result, false); assert(value.reason.length > 0);
}
console.log('push-shot: 7 truthful upload-result checks passed');
