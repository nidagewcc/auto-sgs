// 调试截图专用存储：隐藏于相册，只轮转自己生成的截图，不扫描其他目录。
sgs = (typeof sgs === "undefined") ? {} : sgs;
sgs.debugShots = {
    ROOT: "/sdcard/Download/autosgs-logs/",
    DIR: "/sdcard/Download/autosgs-logs/screenshots/",
    KEEP: 20,
    _seq: 0,
    _lock: threads.lock(),
    _ready: false,

    // 只允许已知的物理存储位置，遇到目录或文件符号链接时拒绝写入/删除。
    _checkDir: function () {
        var dir = new java.io.File(this.DIR);
        if (String(dir.getCanonicalPath()) !== "/storage/emulated/0/Download/autosgs-logs/screenshots") {
            throw new Error("调试截图目录不在预期位置");
        }
    },

    init: function () {
        this._checkDir();
        files.ensureDir(this.DIR);
        // 不覆盖已有 .nomedia。根目录隐藏历史图片，子目录隐藏后续截图。
        var markers = [this.ROOT + ".nomedia", this.DIR + ".nomedia"];
        for (var i = 0; i < markers.length; i++) {
            var expected = markers[i].replace("/sdcard/", "/storage/emulated/0/");
            if (String(new java.io.File(markers[i]).getCanonicalPath()) !== expected) throw new Error("相册隐藏标记路径异常");
            if (!files.exists(markers[i])) files.write(markers[i], "");
        }
        this._ready = true;
    },

    _ownedPath: function (name) {
        if (!/^dbg_\d{13}_\d+_[A-Za-z0-9_-]{1,40}\.png$/.test(name)) return null;
        var p = this.DIR + name;
        var f = new java.io.File(p);
        if (!f.isFile()) return null;
        if (String(f.getCanonicalPath()) !== "/storage/emulated/0/Download/autosgs-logs/screenshots/" + name) return null;
        return p;
    },

    _prune: function () {
        this._checkDir();
        var self = this;
        var names = files.listDir(this.DIR, function (name) { return !!self._ownedPath(String(name)); }) || [];
        // 名字中的时间戳固定 13 位；同毫秒时用序号排序。不递归，不处理未知命名。
        names.sort(function (a, b) {
            var aa = String(a).split("_"), bb = String(b).split("_");
            return Number(bb[1]) - Number(aa[1]) || Number(bb[2]) - Number(aa[2]);
        });
        for (var i = this.KEEP; i < names.length; i++) {
            var p = this._ownedPath(String(names[i]));
            if (p && !files.remove(p)) sgs.log.w("清理旧调试截图失败 " + names[i]);
        }
    },

    save: function (img, tag) {
        if (!img) return null;
        this._lock.lock();
        try {
            if (!this._ready) this.init();
            this._checkDir();
            tag = String(tag || "shot").replace(/[^A-Za-z0-9_-]/g, "_").substring(0, 40) || "shot";
            var p;
            do {
                this._seq++;
                p = this.DIR + "dbg_" + new Date().getTime() + "_" + this._seq + "_" + tag + ".png";
            } while (files.exists(p));
            if (String(new java.io.File(p).getCanonicalPath()) !== p.replace("/sdcard/", "/storage/emulated/0/")) throw new Error("截图文件路径异常");
            images.save(img, p);
            this._prune();
            return p;
        } catch (e) {
            sgs.log.w("保存调试截图失败 " + e);
            return null;
        } finally {
            this._lock.unlock();
        }
    }
};
