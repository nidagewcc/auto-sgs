'use strict';
const assert = require('assert');
const retry = require('../capture/retry-transaction');
const original = { sceneId: 'scene', instanceId: 'ld-5554', sessionId: 'old', state: 'recording' };
function fixture(failAt) {
  const dirs = new Map([['old', { ...original }]]);
  const ops = {
    currentDir: () => 'old',
    discardPath: () => 'discard/old',
    move: (from, to) => { if (failAt === 'move') throw Error('move'); assert(dirs.has(from)); assert(!dirs.has(to)); dirs.set(to, dirs.get(from)); dirs.delete(from); },
    writeDiscarded: (to, m) => { if (failAt === 'write') throw Error('write'); dirs.set(to, { ...m, state: 'discarded' }); },
    // Runtime must provide an all-or-nothing creation operation with its own cleanup.
    createSession: (scene, instance) => { if (failAt === 'create') throw Error('create'); const m = { sceneId: scene, instanceId: instance, sessionId: 'new', state: 'recording' }; dirs.set('new', m); return m; },
    restore: (from, to, m) => { if (failAt === 'restore') throw Error('restore'); dirs.set(to, { ...m }); dirs.delete(from); }
  };
  return { dirs, ops };
}
{
  const f = fixture(); const result = retry.run(f.ops, original, 'scene');
  assert.strictEqual(result.oldSessionId, 'old'); assert.strictEqual(result.newSessionId, 'new');
  assert.strictEqual(f.dirs.get('discard/old').state, 'discarded'); assert.strictEqual(f.dirs.get('new').state, 'recording');
}
for (const failure of ['move', 'write', 'create']) {
  const f = fixture(failure); assert.throws(() => retry.run(f.ops, original, 'scene'));
  assert.deepStrictEqual(f.dirs.get('old'), original); assert(!f.dirs.has('discard/old')); assert(!f.dirs.has('new'));
}
{
  const f = fixture(); f.ops.writeDiscarded = () => { throw Error('write'); }; f.ops.restore = () => { throw Error('restore'); };
  assert.throws(() => retry.run(f.ops, original, 'scene'), e => e.recoveryFailed === true && e.discardDir === 'discard/old');
}
assert.throws(() => retry.run(fixture().ops, original, 'other'));
// Recovery runs before command processing and refuses ambiguous disk layouts.
for (const phase of ['moving', 'moved', 'created', 'committed']) {
  const tx = { phase, oldDir: 'old', discardDir: 'discard/old', newDir: 'new' };
  const dirs = new Set(phase === 'moving' ? ['old'] : phase === 'moved' ? ['discard/old'] : ['discard/old', 'new']);
  let removed = false;
  const ops = { validate() {}, exists: p => dirs.has(p), hasUnexpected: () => false,
    validateOld() {}, validateNew() {}, finishDiscard() {}, createNew: t => dirs.add(t.newDir),
    finishNew() {}, saveTx() {}, removeTx() { removed = true; } };
  const result = retry.reconcile(ops, tx);
  assert(removed); assert.strictEqual(result, phase === 'moving' ? null : 'new');
}
{
  const tx = { phase: 'moved', oldDir: 'old', discardDir: 'discard/old', newDir: 'new' };
  const ops = { validate() {}, exists: () => false, hasUnexpected: () => false };
  assert.throws(() => retry.reconcile(ops, tx), /manual recovery/);
}
{
  const tx = { oldDir: 'old', discardDir: 'discard/old', newDir: 'new' };
  const dirs = new Set(['old']), phases = [];
  const ops = { validate() {}, exists: p => dirs.has(p), hasUnexpected: () => false,
    saveTx: t => phases.push(t.phase), move: (a, b) => { dirs.delete(a); dirs.add(b); },
    validateOld() {}, finishDiscard() {}, createNew: t => dirs.add(t.newDir), finishNew() {}, removeTx() {} };
  assert.strictEqual(retry.runDurable(ops, tx), 'new');
  assert.deepStrictEqual(phases, ['moving', 'moved', 'created', 'committed']);
}
// A crash after creating the new session but before persisting `created` must
// validate and retain that session; a mismatch must lock recovery.
for (const valid of [true, false]) {
  const tx = { phase: 'moved', oldDir: 'old', discardDir: 'discard/old', newDir: 'new' };
  const dirs = new Set(['discard/old', 'new']); let validated = false, created = false, removed = false;
  const ops = { validate() {}, exists: p => dirs.has(p), hasUnexpected: () => false,
    validateOld() {}, finishDiscard() {}, validateNew() { validated = true; if (!valid) throw Error('manual recovery'); },
    createNew() { created = true; }, finishNew() {}, saveTx() {}, removeTx() { removed = true; } };
  if (valid) assert.strictEqual(retry.reconcile(ops, tx), 'new');
  else assert.throws(() => retry.reconcile(ops, tx), /manual recovery/);
  assert(validated); assert(!created); assert.strictEqual(removed, valid);
}
// A committed transaction stays durable until its own receipt is persisted.
{
  const tx = {phase:'committed', oldDir:'old', discardDir:'discard/old', newDir:'new', rid:'r1700000000000abcd'};
  const dirs = new Set(['discard/old', 'new']); const receipts = new Map([['r1700000000000eeee', 'old request']]);
  let removed = false, fail = true;
  const ops = {validate(){}, exists:p => dirs.has(p), hasUnexpected:()=>false,
    validateOld(){}, validateNew(){}, finishNew(){}, saveTx(){},
    complete(t) { if (fail) throw Error('receipt crash'); if (!receipts.has(t.rid)) receipts.set(t.rid, 'ok'); },
    removeTx(){ removed = true; }};
  assert.throws(() => retry.reconcile(ops, tx), /receipt crash/);
  assert(!removed); assert(!receipts.has(tx.rid));
  fail = false; retry.reconcile(ops, tx); assert(removed); assert.strictEqual(receipts.get(tx.rid), 'ok');
  removed = false; retry.reconcile(ops, tx); assert(removed); assert.strictEqual(receipts.size, 2);
  assert.strictEqual(receipts.get('r1700000000000eeee'), 'old request');
}
console.log('capture retry transaction tests passed');
