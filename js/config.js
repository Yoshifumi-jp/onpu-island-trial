window.ONPU = window.ONPU || {};

// 版の設定。version を変えるときは、index.html の css・js の読み込み先の ?v= もすべて同じ版にする
ONPU.config = {
  version: "v0.2.4",
  debug: false,          // URL に ?debug=1 があるとき true
  questionCount: 10,     // 1回の問題数（デバッグのときは 3）
  allIslandsOpen: false  // 全部の島を開く（デバッグのときは true）
};

try {
  var params = new URLSearchParams(window.location.search);
  if (params.get("debug") === "1") {
    ONPU.config.debug = true;
    ONPU.config.questionCount = 3;
    ONPU.config.allIslandsOpen = true;
  }
} catch (e) {
  // URLの読み取りに失敗しても処理を継続する
}

