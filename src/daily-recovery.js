// daily-recovery.js -- conservative daily boundary recovery (Rhino ES5).
sgs = (typeof sgs === "undefined") ? {} : sgs;
sgs.dailyRecovery = (function () {
    function throwCancelled(check) {
        if (check && check()) {
            var e = new Error("日常任务已取消");
            e.cancelled = true;
            throw e;
        }
    }
    function regionText(v, rect, im) {
        return rect ? String(v.ocrRect(rect, im) || "").replace(/\s+/g, "") : "";
    }
    function has(v, word, rect, im) { return regionText(v, rect, im).indexOf(word) >= 0; }
    function hit(v, t, name, region, im) {
        return t && t[name] && t[region] ? v.find(t[name], 0.85, t[region], im) : null;
    }
    // Every query below uses the caller's frame; never call task private helpers.
    function inspect(im) {
        var v = sgs.vision, ts = sgs.tasks || {}, m = ts.mail, x = ts.xiaoqiao;
        var j = ts.junqing, z = ts.zhuxian, pages = sgs.PAGES || {}, out = {};
        var k, p;
        for (k in pages) {
            if (!pages.hasOwnProperty(k)) continue;
            p = pages[k];
            if (p.text && p.region && has(v, p.text, p.region, im)) {
                out.blocked = true;
                out.exception = true;
            }
        }
        if (m) {
            out.mailClaim = hit(v, m, "CLAIM", "CLAIM_REGION", im);
            out.mailClose = hit(v, m, "CLOSE", "CLOSE_REGION", im);
            out.mailReward = hit(v, m, "REWARD", "REWARD_REGION", im);
        }
        if (x) {
            out.again = has(v, "再次执行", x.AGAIN_REGION, im);
            // Left button opposite CONFIRM_REGION. No inferred tap unless its label is explicit.
            out.cancelRect = [950, 800, 1320, 925];
            out.cancel = out.again && regionText(v, out.cancelRect, im) === "取消";
            out.xPanel = has(v, x.TAB_TEXT || "日常功能", x.TAB_REGION, im)
                || regionText(v, x.TAB_REGION, im) === "日常" || hit(v, x, "KAIQI", "KAIQI_REGION", im);
            out.xReward = /恭喜获得|贡献获得/.test(regionText(v, x.REWARD_REGION, im));
            out.xResult = has(v, "执行完成", x.COMPLETION_REGION, im);
        }
        if (j) {
            out.jPanel = /敌军入侵|十万火急/.test(regionText(v, j.TITLE_REGION, im));
            out.jReward = has(v, "恭喜获得", j.REWARD_REGION, im);
        }
        if (z) {
            out.zDialog = /重置副本|元宝|体力不足|确认|取消/.test(regionText(v, z.CENTER_DIALOG_REGION, im))
                || /重置副本|元宝/.test(regionText(v, z.RESET_DIALOG_REGION, im));
            out.zReport = has(v, "扫荡战报", z.REPORT_TITLE_REGION, im);
            out.zPanel = /次数.*[0-5]\/5/.test(regionText(v, z.ATTEMPT_REGION, im));
            out.zMap = has(v, "主线副本", z.MAP_TAB_REGION, im)
                || has(v, "跳过剧情", z.MAP_SKIP_REGION, im);
            out.zStage = has(v, "排行榜", z.STAGE_RANK_REGION, im);
        }
        out.blocked = out.blocked || out.mailClaim || out.mailClose || out.mailReward
            || out.again || out.xPanel || out.xReward || out.xResult || out.jPanel || out.jReward
            || out.zDialog || out.zReport || out.zPanel || out.zMap || out.zStage;
        return out;
    }
    function landscape(im) {
        if (!im || im.getWidth() <= im.getHeight()) return false;
        var ratio = im.getWidth() / im.getHeight();
        return Math.abs(ratio - 2772 / 1280) < 0.22;
    }
    function strictHome(im, state) {
        if (!landscape(im)) return false;
        var v = sgs.vision, a = sgs.ANCHOR, roi = sgs.ROI && sgs.ROI.playerInfo;
        if (!a || !a.region || !roi || !roi.physical || !roi.energy || state.blocked) return false;
        if (!v.find(a.image, Math.max(0.85, a.threshold || 0), a.region, im)) return false;
        function fraction(rect) {
            var m = regionText(v, rect, im).match(/(\d+)\/(\d+)/);
            return !!m && Number(m[2]) > 0;
        }
        return fraction(roi.physical) && fraction(roi.energy);
    }
    function homeReady(img) {
        var im = img || sgs.vision.frame(true);
        if (!landscape(im)) return false;
        return strictHome(im, inspect(im));
    }
    function externalApp() {
        if (typeof currentPackage !== "function") return true;
        var pkg;
        try { pkg = currentPackage(); } catch (e) { return true; }
        // 前台未知同样不能授权点击，不能把相册中的游戏截图当作可操作游戏。
        return pkg !== sgs.game.PKG;
    }
    function ensureHome(lastTaskId, checkCancelled, initial) {
        var v = sgs.vision, start = new Date().getTime(), consecutive = 0;
        // initial is retained for callers; login is always performed manually.
        var ts = sgs.tasks || {}, x = ts.xiaoqiao;
        var j = ts.junqing, z = ts.zhuxian;
        function check() { throwCancelled(checkCancelled); }
        function pause() { sleep(700); check(); }
        function tap(point) {
            check();
            if (externalApp()) return false;
            v.tap(point[0], point[1], 0);
            return true;
        }
        for (var attempt = 0; attempt < 12 && new Date().getTime() - start < 30000; attempt++) {
            check();
            if (externalApp()) return false;
            var im = v.frame(true);
            check();
            if (!im) return false;
            if (!landscape(im) || externalApp()) return false;
            var state = inspect(im);
            check();
            var ready = strictHome(im, state);
            check();
            if (externalApp()) return false;
            if (ready) {
                consecutive++;
                if (consecutive >= 2) return true;
                pause();
                continue;
            }
            consecutive = 0;
            if (externalApp()) return false;
            var point = null;
            // Login, relogin and notices require manual intervention, even over known panels.
            if (state.exception) return false;
            // Dialogs take priority over every background panel.
            if (state.again) {
                if (lastTaskId !== "xiaoqiao" || !state.cancel) return false;
                var r = state.cancelRect;
                point = [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
            } else if (state.zDialog) return false;
            else if (lastTaskId === "mail" && state.mailClaim && state.mailClose) {
                point = [state.mailClose.x, state.mailClose.y];
            } else if (lastTaskId === "xiaoqiao" && state.xReward) point = x.BLANK_TAP;
            else if (lastTaskId === "xiaoqiao" && state.xPanel && !state.xResult) point = x.PANEL_CLOSE;
            else if (lastTaskId === "junqing" && state.jReward) point = j.BLANK;
            else if (lastTaskId === "junqing" && state.jPanel) point = j.CLOSE_X;
            else if (lastTaskId === "zhuxian" && (state.zReport || state.zPanel)) point = z.BLUE_X;
            else if (lastTaskId === "zhuxian" && (state.zMap || state.zStage)) point = z.BACK_ARROW;
            if (!point || !tap(point)) return false;
            pause();
        }
        check();
        return false;
    }
    return { homeReady: homeReady, ensureHome: ensureHome };
})();
