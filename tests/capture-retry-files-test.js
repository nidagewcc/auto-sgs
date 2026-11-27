'use strict';
// Exercise recovery against actual directories and atomic transaction files.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const retry = require('../capture/retry-transaction');

for (const phase of ['moving', 'moved', 'created', 'committed', 'inconsistent']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sgs-retry-'));
  try {
    const tx = { phase: phase === 'inconsistent' ? 'moved' : phase, oldDir: path.join(root, 'old'), discardDir: path.join(root, 'discard', 'old'), newDir: path.join(root, 'new') };
    const txFile = path.join(root, 'capture-tx.json');
    fs.mkdirSync(path.dirname(tx.discardDir));
    function put(dir, state) { fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'session-manifest.json'), JSON.stringify({ state })); }
    if (phase === 'moving') put(tx.oldDir, 'recording');
    if (['moved', 'created', 'committed'].includes(phase)) put(tx.discardDir, 'discarded');
    if (['created', 'committed'].includes(phase)) put(tx.newDir, 'recording');
    const save = t => { const tmp = txFile + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(t)); fs.renameSync(tmp, txFile); };
    save(tx);
    const ops = { validate() {}, exists: fs.existsSync, hasUnexpected: () => false,
      validateOld(t) { assert.strictEqual(JSON.parse(fs.readFileSync(path.join(t.discardDir, 'session-manifest.json'))).state, 'discarded'); },
      validateNew(t) { assert.strictEqual(JSON.parse(fs.readFileSync(path.join(t.newDir, 'session-manifest.json'))).state, 'recording'); },
      finishDiscard() {}, createNew(t) { put(t.newDir, 'recording'); }, finishNew(t) { this.validateNew(t); },
      saveTx: save, removeTx() { fs.unlinkSync(txFile); } };
    const loaded = JSON.parse(fs.readFileSync(txFile));
    if (phase === 'inconsistent') { assert.throws(() => retry.reconcile(ops, loaded), /manual recovery/); assert(fs.existsSync(txFile)); }
    else { const result = retry.reconcile(ops, loaded); assert.strictEqual(result, phase === 'moving' ? null : tx.newDir); assert(!fs.existsSync(txFile)); if (phase !== 'moving') { ops.validateOld(tx); ops.validateNew(tx); } }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
console.log('capture retry filesystem recovery tests passed');
