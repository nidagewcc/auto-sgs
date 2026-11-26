// 引擎清理仅限本项目同一个入口文件，不停止其他 AutoJs6 脚本。
sgs = (typeof sgs === "undefined") ? {} : sgs;
sgs.lifecycle = {
    MAIN: "/storage/emulated/0/脚本/auto-sgs/_main.js",
    _engine: function (value) {
        try { value.getId(); return value; } catch (e) { return value.getEngine(); }
    },
    _isProject: function (engine) {
        try {
            var source = String(engine.getSource());
            if (source.charAt(0) !== "/") return false;
            return String(new java.io.File(source).getCanonicalPath()) === this.MAIN;
        } catch (e) { return false; }
    },
    stopOtherEngines: function () {
        var mine = this._engine(engines.myEngine());
        var all = engines.all(), killed = 0;
        for (var i = 0; i < all.length; i++) {
            try {
                var engine = this._engine(all[i]);
                if (engine.getId() === mine.getId() || !this._isProject(engine)) continue;
                engine.forceStop();
                killed++;
            } catch (e) { sgs.log.w("停止本项目旧引擎失败 " + e); }
        }
        return killed;
    }
};
