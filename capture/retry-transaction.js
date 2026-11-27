'use strict';
// Called only while the capture runtime holds its frame/command mutex.
// Operations are injected so the same transition can be tested without Android.
(function (root) {
  function run(ops, current, scene) {
    if (!current || current.sceneId !== scene || (current.state !== 'recording' && current.state !== 'failed')) {
      throw new Error('没有可重录的当前场景');
    }
    var oldDir = ops.currentDir(), moved = false, destination = null;
    try {
      // The caller must hold the mutex before entering: any in-flight frame has
      // completed, and new frame writers cannot enter until this function returns.
      destination = ops.discardPath(current);
      ops.move(oldDir, destination);
      moved = true;
      ops.writeDiscarded(destination, current);
      var next = ops.createSession(scene, current.instanceId);
      return { oldSessionId: current.sessionId, newSessionId: next.sessionId, manifest: next };
    } catch (error) {
      if (moved) {
        try { ops.restore(destination, oldDir, current); }
        catch (restoreError) {
          var composite = new Error('重录失败且回退失败，需要人工处理：' + error + '；' + restoreError);
          composite.cause = error;
          composite.recoveryFailed = true;
          composite.oldDir = oldDir;
          composite.discardDir = destination;
          throw composite;
        }
      }
      throw error;
    }
  }
  // Recovery is deliberately conservative: an unexpected layout is never repaired by guessing.
  function reconcile(ops, tx) {
    if (!tx || ['moving', 'moved', 'created', 'committed'].indexOf(tx.phase) < 0) throw new Error('invalid capture transaction');
    ops.validate(tx);
    var oldExists = ops.exists(tx.oldDir), discarded = ops.exists(tx.discardDir), fresh = ops.exists(tx.newDir);
    if (ops.hasUnexpected(tx) || (oldExists && discarded) || (!oldExists && !discarded)) throw new Error('capture transaction requires manual recovery');
    if (tx.phase === 'moving' && oldExists && !fresh) { ops.removeTx(); return null; }
    if (oldExists || !discarded) throw new Error('capture transaction requires manual recovery');
    if (tx.phase === 'moving' || tx.phase === 'moved') {
      ops.validateOld(tx);
      // Validate the already-created session before modifying either directory.
      // It can exist when the process dies before persisting the created phase.
      if (fresh) ops.validateNew(tx);
      ops.finishDiscard(tx);
      if (!fresh) ops.createNew(tx);
      tx.phase = 'created'; ops.saveTx(tx);
    } else {
      if (!fresh) throw new Error('capture transaction requires manual recovery');
      ops.validateOld(tx); ops.validateNew(tx);
    }
    ops.finishNew(tx);
    tx.phase = 'committed'; ops.saveTx(tx);
    if (ops.complete) ops.complete(tx);
    ops.removeTx();
    return tx.newDir;
  }
  // The caller serializes frame writes and persists each stage before the next action.
  function runDurable(ops, tx) {
    ops.validate(tx);
    if (ops.exists(tx.oldDir) !== true || ops.exists(tx.discardDir) || ops.exists(tx.newDir) || ops.hasUnexpected(tx)) throw new Error('capture transaction requires manual recovery');
    tx.phase = 'moving'; ops.saveTx(tx);
    ops.move(tx.oldDir, tx.discardDir);
    tx.phase = 'moved'; ops.saveTx(tx);
    ops.validateOld(tx); ops.finishDiscard(tx); ops.createNew(tx);
    tx.phase = 'created'; ops.saveTx(tx);
    ops.finishNew(tx);
    tx.phase = 'committed'; ops.saveTx(tx);
    if (ops.complete) ops.complete(tx);
    ops.removeTx();
    return tx.newDir;
  }
  var api = { run: run, reconcile: reconcile, runDurable: runDurable };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.captureRetryTransaction = api;
})(this);
