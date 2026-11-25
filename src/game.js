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
        v._landForce = false;
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
                sgs.log.i("已到主城 " + Math.round((new Date().getTime() - t0) / 1000) + "s");
                return true;
            }

            if (g._recover(im, v)) { sleep(2000); continue; }

            // 认不出任何已知页面：可能是黑屏/加载中，先等；超过 3 次才考虑拉起
            blank++;
            if (blank >= 3) {
                var cur = "";
                try { cur = currentPackage(); } catch (e) { cur = ""; }
                sgs.log.i("第" + blank + "次认不出画面，前台=" + cur);
                if (cur !== g.PKG && launched < 1) {
                    launched++;
                    sgs.log.i("拉起游戏（仅一次）");
                    try { app.launchPackage(g.PKG); } catch (e1) { sgs.log.e("拉起失败 " + e1); }
                    sleep(8000);
                    g._initCap(false);
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
