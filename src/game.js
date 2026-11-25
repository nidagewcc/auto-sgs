// game.js —— 游戏就绪检测与异常页自愈
sgs = (typeof sgs === "undefined") ? {} : sgs;

sgs.game = {
    PKG: "com.sanguosha.mjz.mi",

    /** 建画布（不切前台） */
    _initCap: function (land) {
        var v = sgs.vision;
        v._capOk = false;
        v.reset();
        v._landForce = !!land;
        return v.init();
    },

    /**
     * 确保在游戏主城。
     * 原则：不主动把游戏拉前台。切前台会触发游戏 loading，久了直接掉线。
     * 先看图（主城/公告/登录/掉线），认不出且前台不是游戏时才拉一次。
     */
    ensure: function (maxMs) {
        maxMs = maxMs || 120000;
        var v = sgs.vision;
        var g = sgs.game;

        v._capOk = false;
        v.reset();
        // 进程内「首次」申请决定画布方向，之后改参数无效。
        // AutoJs6 的 requestScreenCapture(true) 确实能给出 2772x1280，所以首次就强制横屏。
        v._landForce = true;
        if (!v.init()) throw new Error("截图权限失败");

        var t0 = new Date().getTime();
        var notLand = 0;
        var launched = 0;
        var blank = 0;

        while (new Date().getTime() - t0 < maxMs) {
            var im = v.frame(true);
            if (!im) { sleep(1500); continue; }

            if (im.getWidth() <= im.getHeight()) {
                notLand++;
                if (notLand >= 2) {
                    sgs.log.i("画布竖屏，强制横屏重建");
                    g._initCap(true);
                    notLand = 0;
                }
                sleep(1200);
                continue;
            }
            notLand = 0;

            if (v.isHome(im)) {
                // 刚被拉回前台时游戏还在同步 loading：画面看着像主城，
                // 但点击全被吞，这时候干活等于白点（邮件「全部领取」就栽在这）
                sgs.log.i("画面已是主城 " + Math.round((new Date().getTime() - t0) / 1000) + "s，等同步完成");
                sleep(4000);
                var imS = v.frame(true);
                if (imS && v.isHome(imS)) {
                    sgs.log.i("同步完成，可交互 " + Math.round((new Date().getTime() - t0) / 1000) + "s");
                    return true;
                }
                sgs.log.w("复检仍不稳定，继续等");
                sleep(1500);
                continue;
            }

            if (g._recover(im, v)) { sleep(2000); continue; }

            // 认不出任何已知页面：可能是黑屏/加载中，先等；超过 3 次才考虑拉起
            blank++;
            if (blank >= 3) {
                var cur = "";
                try { cur = currentPackage(); } catch (e) { cur = ""; }
                var inGame = (cur === g.PKG);
                sgs.log.i("第" + blank + "次认不出画面，前台=" + (cur || "未知"));
                // 前台为空说明拿不到判定（无障碍异常），按"不在游戏"处理；
                // 只要当前前台确实是游戏就别拉，避免打断加载导致 loading 循环掉线
                if (!inGame && launched < 2) {
                    launched++;
                    sgs.log.i("拉起游戏（第 " + launched + " 次）");
                    try { app.launchPackage(g.PKG); } catch (e1) { sgs.log.e("拉起失败 " + e1); }
                    sleep(12000);
                    blank = 0;
                }
            }
            sleep(1800);
        }
        sgs.log.e("超时未到主城");
        return false;
    },

    /** 处理掉线/公告/登录页；返回 true 表示点掉了一个页面 */
    _recover: function (im, v) {
        var P = sgs.PAGES;
        if (!P) return false;

        if (v.hasText(P.relogin.text, P.relogin.region, im)) {
            sgs.log.i("掉线弹窗，点重新登录");
            v.tap(P.relogin.point[0], P.relogin.point[1]);
            return true;
        }
        if (v.hasText(P.notice.text, P.notice.region, im)) {
            sgs.log.i("公告弹窗，点关闭");
            v.tap(P.notice.point[0], P.notice.point[1]);
            return true;
        }
        if (v.hasText(P.login.text, P.login.region, im)) {
            sgs.log.i("登录页，点进入游戏");
            v.tap(P.login.point[0], P.login.point[1]);
            return true;
        }
        return false;
    },

    /** 等待主城（沿用旧入口，内部走 ensure） */
    waitHome: function (maxMs) {
        return this.ensure(maxMs);
    }
};
