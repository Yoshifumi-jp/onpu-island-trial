window.ONPU = window.ONPU || {};

(function () {
  "use strict";

  // iPhone・iPad でボタンを押したときの :active（縮む動き）を有効にする
  document.addEventListener("touchstart", function () {}, { passive: true });

  var STAGE_WIDTH = 1194;
  var STAGE_HEIGHT = 834;
  var toastTimerId = null;
  var currentIslandKey = null;
  var currentLevel = null;
  var currentSession = null;
  var nextTimerId = null;
  var earTimerId = null;
  var waitingNext = false;
  var lastCorrectKey = null; // 前に鳴らした正解のメロディの名前
  var currentClef = "treble"; // レベルを選ぶ画面で今選んでいる記号（"treble"／"bass"）

  var RHYTHM_SPEED_ORDER = ["slow", "normal", "fast"];
  var RHYTHM_GLYPH_WIDTH = {
    ta: 34,
    titi: 86,
    un: 35,
    taan: 31
  };

  var rhythmSpeedKey = "slow";
  var rhythmLevel = null;
  var rhythmQuestions = [];
  var rhythmQIndex = 0;
  var rhythmAttempt = 1;
  var rhythmResults = [];
  var rhythmLastResult = null;
  var rhythmFlowTimerId = null;
  var clearKind = "doremi";
  var rhythmState = "waiting";
  var rhythmRafId = null;
  var rhythmAutoTimerId = null;
  var rhythmDotTimers = [];
  var rhythmCardEls = [];
  var rhythmDotEls = [];
  var rhythmPattern = [];
  var rhythmBpm = 60;
  var rhythmBeatSec = 1;
  var rhythmLat = 0;
  var rhythmBase = 0;
  var rhythmStart = 0;
  var rhythmModelTimeline = null;
  var rhythmSoundQueue = [];
  var rhythmTaps = [];
  var rhythmLeadText = null;
  var rhythmLeadBeatNum = null;

  // 島ごとの問題画面の設定
  var ISLANDS = {
    doremi: {
      titleTextId: "map.island.doremi",
      questionTextId: "doremi.question",
      earQuestionTextId: "doremi.question.ear",
      hintTextId: "doremi.hint",
      earHintTextId: "doremi.hint.ear",
      bgColor: "var(--doremi-bg)",
      getAnswers: function () {
        return (ONPU.music && Array.isArray(ONPU.music.ANSWERS)) ? ONPU.music.ANSWERS : [];
      },
      answerOf: function (q) {
        return (ONPU.music && typeof ONPU.music.answerOf === "function") ? ONPU.music.answerOf(q) : null;
      }
    }
  };

  // 文言の取得と {version}・{stars} などの置き換え
  function getText(id, params) {
    var raw = (ONPU.texts && ONPU.texts[id]) ? ONPU.texts[id] : "";
    if (!params) {
      return raw;
    }
    return raw.replace(/\{(\w+)\}/g, function (match, key) {
      return Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match;
    });
  }

  // ウィンドウの大きさに合わせて #stage を縦横比を保ったまま拡大・縮小して中央に置く
  function updateStageScale() {
    var stage = document.getElementById("stage");
    if (!stage) {
      return;
    }
    var winW = window.innerWidth;
    var winH = window.innerHeight;
    var scale = Math.min(winW / STAGE_WIDTH, winH / STAGE_HEIGHT);
    stage.style.transform = "translate(-50%, -50%) scale(" + scale + ")";
  }

  // 画面への文言の流し込み
  function applyTexts() {
    document.title = getText("app.name");

    // data-text 属性を持つ要素に文言を入れる
    var textNodes = document.querySelectorAll("[data-text]");
    for (var i = 0; i < textNodes.length; i++) {
      var el = textNodes[i];
      var key = el.getAttribute("data-text");
      el.textContent = getText(key);
    }

    // data-aria-label 属性を持つ要素に aria-label を入れる
    var ariaNodes = document.querySelectorAll("[data-aria-label]");
    for (var j = 0; j < ariaNodes.length; j++) {
      var ariaEl = ariaNodes[j];
      var ariaKey = ariaEl.getAttribute("data-aria-label");
      ariaEl.setAttribute("aria-label", getText(ariaKey));
    }

    // 右上の★の数（M1 では {stars} に 0 を入れる）
    var starTotalEl = document.getElementById("map-star-total");
    if (starTotalEl) {
      starTotalEl.textContent = getText("map.star.total", { stars: 0 });
    }

    // 設定画面のバージョン表示
    var versionEl = document.getElementById("settings-version");
    if (versionEl) {
      var ver = (ONPU.config && ONPU.config.version) ? ONPU.config.version : "";
      versionEl.textContent = getText("settings.version", { version: ver });
    }

    // デバッグモードのバッジ表示
    var debugBadge = document.getElementById("debug-badge");
    if (debugBadge) {
      if (ONPU.config && ONPU.config.debug) {
        debugBadge.textContent = getText("debug.badge");
        debugBadge.hidden = false;
      } else {
        debugBadge.hidden = true;
      }
    }

    updateRhythmSpeedButton();
  }

  // 画面（section）の切り替え
  function showScreen(screenId) {
    var screens = document.querySelectorAll(".screen");
    for (var i = 0; i < screens.length; i++) {
      var s = screens[i];
      if (s.id === screenId) {
        s.classList.add("active");
      } else {
        s.classList.remove("active");
      }
    }
  }

  // 案内（トースト）を2秒表示して消す（表示中に再度押されたら2秒延長）
  function showToast(message) {
    var toast = document.getElementById("toast");
    if (!toast) {
      return;
    }
    toast.textContent = message;
    toast.classList.add("visible");

    if (toastTimerId !== null) {
      clearTimeout(toastTimerId);
    }
    toastTimerId = setTimeout(function () {
      toast.classList.remove("visible");
      toastTimerId = null;
    }, 2000);
  }

  // Pointer Events（指とマウスの両方に対応）でボタンを押したときのイベント登録
  function bindButton(id, handler) {
    var btn = document.getElementById(id);
    if (!btn) {
      return;
    }
    var activePointerId = null;
    btn.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) {
        return;
      }
      activePointerId = e.pointerId;
    });
    btn.addEventListener("pointerup", function (e) {
      if (activePointerId !== null && e.pointerId === activePointerId) {
        activePointerId = null;
        handler(e);
      }
    });
    btn.addEventListener("pointercancel", function () {
      activePointerId = null;
    });
    btn.addEventListener("pointerleave", function () {
      activePointerId = null;
    });
    // キーボード操作（Enter / Space）への対応
    btn.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handler(e);
      }
    });
  }

  // おうちの方の画面の「おとの たしかめ」の鍵盤ボタンを作る
  function buildSoundKeys() {
    var container = document.getElementById("settings-keys");
    if (!container || !ONPU.music || !Array.isArray(ONPU.music.KEYS)) {
      return;
    }
    container.innerHTML = "";
    for (var i = 0; i < ONPU.music.KEYS.length; i++) {
      var keyInfo = ONPU.music.KEYS[i];
      var btn = document.createElement("button");
      btn.type = "button";
      btn.id = "btn-key-" + keyInfo.name;
      btn.className = "settings-key-btn";
      btn.style.backgroundColor = keyInfo.color;
      btn.setAttribute("data-text", keyInfo.textId);
      container.appendChild(btn);
    }
  }

  // おうちの方の画面の「おとの たしかめ」のボタン動作を登録する
  function bindSoundButtons() {
    if (ONPU.music && Array.isArray(ONPU.music.KEYS)) {
      for (var i = 0; i < ONPU.music.KEYS.length; i++) {
        (function (noteName) {
          bindButton("btn-key-" + noteName, function () {
            if (ONPU.audio && typeof ONPU.audio.playNote === "function") {
              ONPU.audio.playNote(noteName, 0.5);
            }
          });
        })(ONPU.music.KEYS[i].name);
      }
    }

    bindButton("btn-sound-drum", function () {
      if (ONPU.audio && typeof ONPU.audio.playDrum === "function") {
        ONPU.audio.playDrum();
      }
    });

    bindButton("btn-sound-correct", function () {
      if (ONPU.audio && typeof ONPU.audio.playMelody === "function") {
        ONPU.audio.playMelody("correct");
      }
    });

    bindButton("btn-sound-clear", function () {
      if (ONPU.audio && typeof ONPU.audio.playMelody === "function") {
        ONPU.audio.playMelody("clear");
      }
    });

    bindButton("btn-sound-unlock", function () {
      if (ONPU.audio && typeof ONPU.audio.playMelody === "function") {
        ONPU.audio.playMelody("unlock");
      }
    });
  }

  // 次の問題やレベル4の自動再生のタイマーを止める
  function stopQuizTimer() {
    if (nextTimerId !== null) {
      clearTimeout(nextTimerId);
      nextTimerId = null;
    }
    if (earTimerId !== null) {
      clearTimeout(earTimerId);
      earTimerId = null;
    }
    waitingNext = false;
  }

  // レベルを選ぶ画面のカードを作って動作を登録する
  function buildLevelCards() {
    var container = document.getElementById("level-cards");
    if (!container || !ONPU.music) {
      return;
    }
    var isBass = currentClef === "bass";
    var list = isBass ? ONPU.music.BASS_LEVELS : ONPU.music.LEVELS;
    if (!Array.isArray(list)) {
      return;
    }
    var idPrefix = isBass ? "btn-level-bass-" : "btn-level-";
    container.innerHTML = "";
    for (var i = 0; i < list.length; i++) {
      var lv = list[i];
      var btnId = idPrefix + lv.level;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.id = btnId;
      btn.className = "level-card";

      var badge = document.createElement("span");
      badge.className = "level-badge";
      badge.style.backgroundColor = lv.color;
      badge.textContent = String(lv.level);

      var nameEl = document.createElement("span");
      nameEl.className = "level-name";
      nameEl.textContent = getText("level.name", { level: lv.level });

      var descEl = document.createElement("span");
      descEl.className = "level-desc";
      descEl.textContent = getText(lv.textId);

      btn.appendChild(badge);
      btn.appendChild(nameEl);
      btn.appendChild(descEl);
      container.appendChild(btn);

      (function (buttonId, levelInfo) {
        bindButton(buttonId, function () {
          startQuiz("doremi", levelInfo);
        });
      })(btnId, lv);
    }
  }

  // レベルを選ぶ画面の記号タブを切り替える
  function selectClef(clef) {
    if (clef !== "treble" && clef !== "bass") {
      return;
    }
    currentClef = clef;
    var isTreble = clef === "treble";
    var trebleTab = document.getElementById("btn-clef-treble");
    if (trebleTab) {
      trebleTab.classList.toggle("on", isTreble);
      trebleTab.setAttribute("aria-pressed", isTreble ? "true" : "false");
    }
    var bassTab = document.getElementById("btn-clef-bass");
    if (bassTab) {
      bassTab.classList.toggle("on", !isTreble);
      bassTab.setAttribute("aria-pressed", !isTreble ? "true" : "false");
    }
    buildLevelCards();
  }

  // リズムの森のレベルを選ぶカードを作って動作を登録する
  function buildRhythmLevelCards() {
    var container = document.getElementById("level-cards");
    if (!container || !ONPU.rhythm || !Array.isArray(ONPU.rhythm.LEVELS)) {
      return;
    }
    var list = ONPU.rhythm.LEVELS;
    container.innerHTML = "";
    for (var i = 0; i < list.length; i++) {
      var lv = list[i];
      var btnId = "btn-rhythm-level-" + lv.level;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.id = btnId;
      btn.className = "level-card";

      var badge = document.createElement("span");
      badge.className = "level-badge";
      badge.style.backgroundColor = lv.color;
      badge.textContent = String(lv.level);

      var nameEl = document.createElement("span");
      nameEl.className = "level-name";
      nameEl.textContent = getText("level.name", { level: lv.level });

      var descEl = document.createElement("span");
      descEl.className = "level-desc";
      descEl.textContent = getText(lv.textId);

      btn.appendChild(badge);
      btn.appendChild(nameEl);
      btn.appendChild(descEl);
      container.appendChild(btn);

      (function (buttonId, levelInfo) {
        bindButton(buttonId, function () {
          startRhythmSession(levelInfo);
        });
      })(btnId, lv);
    }
  }

  // レベルを選ぶ画面を開く
  function openLevelScreen(islandKey) {
    stopQuizTimer();
    stopRhythmRound();
    var screenEl = document.getElementById("screen-level");
    var titleEl = document.getElementById("level-title");
    var tabsEl = document.getElementById("level-tabs");
    if (islandKey === "rhythm") {
      if (screenEl) {
        screenEl.style.backgroundColor = "var(--rhythm-bg)";
      }
      if (titleEl) {
        titleEl.textContent = getText("rhythm.title");
      }
      if (tabsEl) {
        tabsEl.style.display = "none";
      }
      buildRhythmLevelCards();
    } else {
      if (screenEl) {
        screenEl.style.backgroundColor = "var(--doremi-bg)";
      }
      if (titleEl) {
        titleEl.textContent = getText("map.island.doremi");
      }
      if (tabsEl) {
        tabsEl.style.display = "";
      }
      selectClef(currentClef);
    }
    showScreen("screen-level");
  }

  // 正解・不正解の演出を元に戻す
  function resetQuizFeedback() {
    var mascotEl = document.getElementById("quiz-mascot");
    if (mascotEl) {
      mascotEl.classList.remove("mascot-jump1", "mascot-jump2", "mascot-jump3");
    }
    var hintAnimEl = document.getElementById("quiz-hint");
    if (hintAnimEl) {
      hintAnimEl.classList.remove("hint-pop", "hint-pulse");
    }
    var noteEl = document.getElementById("quiz-note");
    if (noteEl) {
      noteEl.classList.remove("quiz-bounce");
    }
    var noteHeadEl = document.getElementById("quiz-note-head");
    if (noteHeadEl) {
      noteHeadEl.classList.remove("correct");
    }
    var earIconEl = document.getElementById("quiz-ear-icon");
    if (earIconEl) {
      earIconEl.classList.remove("quiz-bounce");
    }
    var answerBtns = document.querySelectorAll(".quiz-answer-btn");
    for (var i = 0; i < answerBtns.length; i++) {
      answerBtns[i].classList.remove("blink");
    }
  }

  // 問題の画面の答えのボタンを並べて動作を登録する
  function buildQuizAnswers(answers) {
    var container = document.getElementById("quiz-answers");
    if (!container || !Array.isArray(answers)) {
      return;
    }
    container.innerHTML = "";
    for (var i = 0; i < answers.length; i++) {
      var ans = answers[i];
      var btn = document.createElement("button");
      btn.type = "button";
      btn.id = "btn-answer-" + ans.id;
      btn.className = ans.id === "fa" ? "quiz-answer-btn quiz-answer-btn-fa" : "quiz-answer-btn";
      btn.style.backgroundColor = ans.color;
      btn.textContent = getText(ans.textId);
      container.appendChild(btn);

      (function (answerId, btnId) {
        bindButton(btnId, function () {
          handleQuizAnswer(answerId);
        });
      })(ans.id, btn.id);
    }
  }

  // 今の問題の音を鳴らす（「おとを きく」ボタンとレベル4の自動再生）
  function playCurrentQuestionSound(question) {
    if (!question || !ONPU.audio) {
      return;
    }
    if (currentLevel && currentLevel.mode === "ear") {
      if (typeof ONPU.audio.playSequence === "function" && ONPU.music && typeof ONPU.music.earSequence === "function") {
        ONPU.audio.playSequence(ONPU.music.earSequence(question));
      }
    } else {
      if (typeof ONPU.audio.playNote === "function") {
        ONPU.audio.playNote(question, 0.8);
      }
    }
  }

  // 今の問題を画面に表示する
  function renderQuizQuestion() {
    if (!currentSession || !ONPU.quiz) {
      return;
    }
    if (earTimerId !== null) {
      clearTimeout(earTimerId);
      earTimerId = null;
    }
    resetQuizFeedback();

    var total = currentSession.questions.length;
    var currentNum = currentSession.index + 1;

    var dotsEl = document.getElementById("quiz-dots");
    if (dotsEl) {
      dotsEl.innerHTML = "";
      for (var i = 0; i < total; i++) {
        var dot = document.createElement("div");
        dot.className = i < currentNum ? "quiz-dot filled" : "quiz-dot";
        dotsEl.appendChild(dot);
      }
    }

    var progressTextEl = document.getElementById("quiz-progress-text");
    if (progressTextEl) {
      progressTextEl.textContent = getText("quiz.progress", {
        current: currentNum,
        total: total
      });
    }

    var q = ONPU.quiz.current(currentSession);
    if (q === null) {
      return;
    }

    if (currentLevel && currentLevel.mode === "ear") {
      earTimerId = setTimeout(function () {
        earTimerId = null;
        playCurrentQuestionSound(q);
      }, 300);
    } else if (ONPU.music) {
      var clef = (currentLevel && currentLevel.clef) ? currentLevel.clef : "treble";
      var cy = ONPU.music.staffY(q, clef);
      var ledger = ONPU.music.needsLedger(q, clef);
      var up = ONPU.music.stemUp(q, clef);

      var ledgerEl = document.getElementById("quiz-ledger");
      if (ledgerEl) {
        ledgerEl.style.display = ledger ? "" : "none";
        if (cy !== null) {
          ledgerEl.setAttribute("y", String(cy - 2));
        }
      }
      var ellipseEl = document.getElementById("quiz-note-ellipse");
      if (ellipseEl && cy !== null) {
        ellipseEl.setAttribute("cy", String(cy));
        ellipseEl.setAttribute("transform", "rotate(-20 433 " + cy + ")");
      }
      var stemEl = document.getElementById("quiz-note-stem");
      if (stemEl && cy !== null && up !== null) {
        stemEl.setAttribute("x", up ? "450" : "410");
        stemEl.setAttribute("y", String(up ? (cy - 128) : cy));
      }
    }
  }

  // クリア画面を表示する
  function showClearScreen() {
    if (!currentSession || !ONPU.quiz) {
      return;
    }
    var total = currentSession.questions.length;
    var correct = currentSession.correct;
    var stars = ONPU.quiz.calcStars(correct, total);

    var titleEl = document.getElementById("clear-title");
    if (titleEl) {
      titleEl.textContent = stars >= 1 ? getText("clear.title") : getText("clear.title.miss");
    }

    var starsEl = document.getElementById("clear-stars");
    if (starsEl) {
      var starText = "";
      for (var i = 0; i < 3; i++) {
        starText += i < stars ? "★" : "☆";
      }
      starsEl.textContent = starText;
    }

    var resultEl = document.getElementById("clear-result");
    if (resultEl) {
      resultEl.textContent = getText("clear.result", {
        total: total,
        correct: correct
      });
    }

    var clearScreen = document.getElementById("screen-clear");
    if (clearScreen) {
      clearScreen.classList.remove("rhythm");
    }
    clearKind = "doremi";

    showScreen("screen-clear");

    if (stars >= 1 && ONPU.audio && typeof ONPU.audio.playMelody === "function") {
      ONPU.audio.playMelody("clear");
    }
  }

  // リズムの森のクリア画面を表示する
  function showRhythmClearScreen() {
    if (!ONPU.rhythm || !ONPU.quiz) {
      return;
    }
    var score = ONPU.rhythm.scoreOf(rhythmResults);
    var stars = ONPU.quiz.calcStars(score, 100);

    var titleEl = document.getElementById("clear-title");
    if (titleEl) {
      titleEl.textContent = stars >= 1 ? getText("clear.title") : getText("clear.title.miss");
    }

    var starsEl = document.getElementById("clear-stars");
    if (starsEl) {
      var starText = "";
      for (var i = 0; i < 3; i++) {
        starText += i < stars ? "★" : "☆";
      }
      starsEl.textContent = starText;
    }

    var scoreNumEl = document.getElementById("clear-score-num");
    if (scoreNumEl) {
      scoreNumEl.textContent = String(score);
    }

    var qdotsEl = document.getElementById("clear-qdots");
    if (qdotsEl) {
      qdotsEl.innerHTML = "";
      for (var k = 0; k < rhythmResults.length; k++) {
        var r = rhythmResults[k];
        var cls = (r === "pittari" || r === "oshii") ? r : "retry";
        var pt = (ONPU.rhythm.POINTS && Object.prototype.hasOwnProperty.call(ONPU.rhythm.POINTS, cls))
          ? ONPU.rhythm.POINTS[cls]
          : 0;

        var dot = document.createElement("div");
        dot.className = "clear-qdot " + cls;

        var numSpan = document.createElement("span");
        numSpan.className = "clear-qdot-num";
        numSpan.textContent = getText("rhythm.clear.qnum", { num: k + 1 });

        var ptSpan = document.createElement("span");
        ptSpan.className = "clear-qdot-pt";
        ptSpan.textContent = String(pt);

        dot.appendChild(numSpan);
        dot.appendChild(ptSpan);
        qdotsEl.appendChild(dot);
      }
    }

    var clearScreen = document.getElementById("screen-clear");
    if (clearScreen) {
      clearScreen.classList.add("rhythm");
    }
    clearKind = "rhythm";

    showScreen("screen-clear");

    if (stars >= 1 && ONPU.audio && typeof ONPU.audio.playMelody === "function") {
      ONPU.audio.playMelody("clear");
    }
  }

  // class を外して付け直し、同じ動きでも毎回はじめから動かす
  function restartClass(el, cls) {
    el.classList.remove(cls);
    el.getBoundingClientRect();
    el.classList.add(cls);
  }

  // 吹き出しを元のヒントに戻し、連続正解の class をすべて外す
  function resetQuizHint() {
    var hintEl = document.getElementById("quiz-hint");
    if (!hintEl) {
      return;
    }
    var island = ISLANDS[currentIslandKey];
    if (island) {
      var isEar = currentLevel && currentLevel.mode === "ear";
      hintEl.textContent = getText(isEar ? island.earHintTextId : island.hintTextId);
    }
    hintEl.classList.remove("streak", "streak-s", "streak-m", "streak-l", "hint-pop", "hint-pulse");
  }

  // 連続正解の吹き出しとキャラの演出（streak が3以上のとき）
  function showStreak(streak) {
    var hintEl = document.getElementById("quiz-hint");
    var stage = streak >= 8 ? "l" : (streak >= 5 ? "m" : "s");
    if (hintEl) {
      hintEl.textContent = getText("quiz.streak", { count: streak });
      hintEl.classList.add("streak");
      hintEl.classList.remove("streak-s", "streak-m", "streak-l");
      hintEl.classList.add("streak-" + stage);
      hintEl.classList.remove("hint-pop", "hint-pulse");
      restartClass(hintEl, stage === "l" ? "hint-pulse" : "hint-pop");
    }
    var mascotEl = document.getElementById("quiz-mascot");
    if (mascotEl) {
      var jumpCls = stage === "l" ? "mascot-jump3" : (stage === "m" ? "mascot-jump2" : "mascot-jump1");
      mascotEl.classList.remove("mascot-jump1", "mascot-jump2", "mascot-jump3");
      restartClass(mascotEl, jumpCls);
    }
  }

  // 答えのボタンが押されたときの処理
  function handleQuizAnswer(answerId) {
    if (waitingNext || !currentSession || currentSession.finished || !ONPU.quiz) {
      return;
    }
    var question = ONPU.quiz.current(currentSession);
    var result = ONPU.quiz.submit(currentSession, answerId);
    if (!result) {
      return;
    }
    if (earTimerId !== null) {
      clearTimeout(earTimerId);
      earTimerId = null;
    }
    waitingNext = true;

    if (result.isCorrect) {
      if (ONPU.audio && typeof ONPU.audio.playMelody === "function") {
        var melodyKey = (ONPU.music && typeof ONPU.music.pickCorrectKey === "function")
          ? ONPU.music.pickCorrectKey(lastCorrectKey)
          : "correct";
        ONPU.audio.playMelody(melodyKey);
        lastCorrectKey = melodyKey;
      }
      if (result.streak >= 3) {
        showStreak(result.streak);
      }
      if (currentLevel && currentLevel.mode === "ear") {
        var earIconEl = document.getElementById("quiz-ear-icon");
        if (earIconEl) {
          earIconEl.classList.add("quiz-bounce");
        }
      } else {
        var noteEl = document.getElementById("quiz-note");
        if (noteEl) {
          noteEl.classList.add("quiz-bounce");
        }
        var noteHeadEl = document.getElementById("quiz-note-head");
        if (noteHeadEl) {
          noteHeadEl.classList.add("correct");
        }
      }
    } else {
      resetQuizHint();
      if (question !== null && ONPU.audio && typeof ONPU.audio.playNote === "function") {
        ONPU.audio.playNote(question, 0.6);
      }
      if (result.correctAnswer) {
        var correctBtn = document.getElementById("btn-answer-" + result.correctAnswer);
        if (correctBtn) {
          correctBtn.classList.add("blink");
        }
      }
    }

    var delay = result.isCorrect ? 900 : 1500;
    nextTimerId = setTimeout(function () {
      nextTimerId = null;
      waitingNext = false;
      if (result.finished) {
        showClearScreen();
      } else {
        renderQuizQuestion();
      }
    }, delay);
  }

  // 指定した島・レベルの問題を始める
  function startQuiz(islandKey, levelInfo) {
    var island = ISLANDS[islandKey];
    if (!island || !ONPU.quiz) {
      return;
    }
    var lv = levelInfo || (ONPU.music && Array.isArray(ONPU.music.LEVELS) ? ONPU.music.LEVELS[0] : null);
    if (!lv) {
      return;
    }
    stopQuizTimer();
    currentIslandKey = islandKey;
    currentLevel = lv;

    var isEar = lv.mode === "ear";

    var quizScreen = document.getElementById("screen-quiz");
    if (quizScreen) {
      quizScreen.style.backgroundColor = island.bgColor;
    }
    var titleEl = document.getElementById("quiz-title");
    if (titleEl) {
      titleEl.textContent = getText(island.titleTextId);
    }
    var questionEl = document.getElementById("quiz-question");
    if (questionEl) {
      questionEl.textContent = getText(isEar ? island.earQuestionTextId : island.questionTextId);
    }
    resetQuizHint();
    var isBass = lv.clef === "bass";
    var clefTrebleEl = document.getElementById("quiz-clef-treble");
    if (clefTrebleEl) {
      clefTrebleEl.style.display = isBass ? "none" : "";
    }
    var clefBassEl = document.getElementById("quiz-clef-bass");
    if (clefBassEl) {
      clefBassEl.style.display = isBass ? "" : "none";
    }
    var staffEl = document.getElementById("quiz-staff");
    if (staffEl) {
      staffEl.style.display = isEar ? "none" : "block";
    }
    var earIconEl = document.getElementById("quiz-ear-icon");
    if (earIconEl) {
      earIconEl.style.display = isEar ? "block" : "none";
    }

    buildQuizAnswers(island.getAnswers());

    var count = (ONPU.config && ONPU.config.questionCount) ? ONPU.config.questionCount : 10;
    var questions = ONPU.quiz.makeQuestions(lv.pool, count);
    currentSession = ONPU.quiz.createSession(questions, island.answerOf, { retry: true });

    renderQuizQuestion();
    showScreen("screen-quiz");
  }

  // リズムの森のはやさのボタンの表示を更新する
  function updateRhythmSpeedButton() {
    var btn = document.getElementById("btn-rhythm-speed");
    if (!btn) {
      return;
    }
    btn.textContent = getText("rhythm.speed", {
      speed: getText("rhythm.speed." + rhythmSpeedKey)
    });
  }

  // リズムの森のカードの上の一言を更新する
  function setRhythmLead(text, isCount, beatNum) {
    var leadEl = document.getElementById("rhythm-lead");
    if (!leadEl) {
      return;
    }
    var hasBeatNum = typeof beatNum === "number" && isFinite(beatNum) && Math.floor(beatNum) === beatNum && beatNum >= 1 && beatNum <= 4;
    var numKey = hasBeatNum ? beatNum : null;
    if (rhythmLeadText !== text || rhythmLeadBeatNum !== numKey) {
      rhythmLeadText = text;
      rhythmLeadBeatNum = numKey;
      leadEl.textContent = text;
      if (hasBeatNum) {
        var numSpan = document.createElement("span");
        numSpan.className = "rhythm-lead-num";
        numSpan.textContent = getText("rhythm.count", { count: beatNum });
        leadEl.appendChild(numSpan);
      }
    }
    leadEl.classList.toggle("count", Boolean(isCount));
  }

  // リズムの森の今の拍のカードを光らせる（-1 のときはすべて消す）
  function setActiveRhythmCard(activeIdx) {
    for (var i = 0; i < rhythmCardEls.length; i++) {
      rhythmCardEls[i].classList.toggle("active", i === activeIdx);
    }
  }

  // リズムの森の点をすべて「たたく前」にもどす
  function resetRhythmDots() {
    for (var i = 0; i < rhythmDotEls.length; i++) {
      rhythmDotEls[i].className = "rhythm-dot";
    }
  }

  // リズムの森の結果の吹き出しを消す
  function hideRhythmBubble() {
    var bubbleEl = document.getElementById("rhythm-bubble");
    if (bubbleEl) {
      bubbleEl.hidden = true;
      bubbleEl.classList.remove("pop");
      bubbleEl.textContent = "";
    }
  }

  // リズムの森の結果のあとのボタンを消す
  function hideRhythmFlowButtons() {
    var retryBtn = document.getElementById("btn-rhythm-retry");
    if (retryBtn) {
      retryBtn.hidden = true;
    }
    var nextBtn = document.getElementById("btn-rhythm-next");
    if (nextBtn) {
      nextBtn.hidden = true;
    }
  }

  // リズムの森の1回の記録を捨てる
  function clearRhythmSession() {
    rhythmQuestions = [];
    rhythmQIndex = 0;
    rhythmAttempt = 1;
    rhythmResults = [];
    rhythmLastResult = null;
  }

  // リズムの森の進行中の繰り返しとタイマーをすべて止め、表示を初期状態にもどす
  function stopRhythmRound() {
    if (rhythmRafId !== null) {
      cancelAnimationFrame(rhythmRafId);
      rhythmRafId = null;
    }
    if (rhythmAutoTimerId !== null) {
      clearTimeout(rhythmAutoTimerId);
      rhythmAutoTimerId = null;
    }
    if (rhythmFlowTimerId !== null) {
      clearTimeout(rhythmFlowTimerId);
      rhythmFlowTimerId = null;
    }
    for (var i = 0; i < rhythmDotTimers.length; i++) {
      clearTimeout(rhythmDotTimers[i]);
    }
    rhythmDotTimers = [];
    rhythmSoundQueue = [];
    rhythmTaps = [];
    rhythmState = "waiting";
    setActiveRhythmCard(-1);
    setRhythmLead(getText("rhythm.lead"), false);
    hideRhythmBubble();
    hideRhythmFlowButtons();
    resetRhythmDots();
  }

  // リズムの森の今の問題のカードと点の列、進み具合を作る
  function renderRhythmPattern() {
    rhythmPattern = rhythmQuestions[rhythmQIndex] || [];
    var total = rhythmQuestions.length;
    var currentNum = rhythmQIndex + 1;

    var progDotsEl = document.getElementById("rhythm-progress-dots");
    if (progDotsEl) {
      progDotsEl.innerHTML = "";
      for (var p = 0; p < total; p++) {
        var pDot = document.createElement("div");
        pDot.className = p < currentNum ? "quiz-dot filled" : "quiz-dot";
        progDotsEl.appendChild(pDot);
      }
    }

    var progTextEl = document.getElementById("rhythm-progress-text");
    if (progTextEl) {
      progTextEl.textContent = getText("quiz.progress", {
        current: currentNum,
        total: total
      });
    }

    var cardsContainer = document.getElementById("rhythm-cards");
    var dotsContainer = document.getElementById("rhythm-dots");
    rhythmCardEls = [];
    rhythmDotEls = [];
    if (!cardsContainer || !dotsContainer) {
      return;
    }
    cardsContainer.innerHTML = "";
    dotsContainer.innerHTML = "";

    for (var i = 0; i < rhythmPattern.length; i++) {
      var id = rhythmPattern[i];
      var isWide = id === "taan";
      var w = RHYTHM_GLYPH_WIDTH[id] || 34;

      var cardEl = document.createElement("div");
      cardEl.className = isWide ? "rhythm-card wide" : "rhythm-card";
      cardEl.innerHTML =
        '<svg width="' + w + '" height="104" aria-hidden="true"><use href="#glyph-' + id + '"/></svg>' +
        '<span class="rhythm-card-label">' + getText("rhythm.card." + id) + "</span>";
      cardsContainer.appendChild(cardEl);
      rhythmCardEls.push(cardEl);

      var colEl = document.createElement("div");
      colEl.className = isWide ? "rhythm-dot-col wide" : "rhythm-dot-col";
      var hitCount = (ONPU.rhythm && ONPU.rhythm.CARDS && ONPU.rhythm.CARDS[id])
        ? ONPU.rhythm.CARDS[id].hits.length
        : 0;
      for (var k = 0; k < hitCount; k++) {
        var dotEl = document.createElement("div");
        dotEl.className = "rhythm-dot";
        colEl.appendChild(dotEl);
        rhythmDotEls.push(dotEl);
      }
      dotsContainer.appendChild(colEl);
    }
  }

  // まだ予約していない音のうち、時刻が now + 0.15 秒以内のものだけを予約する
  function scheduleDueRhythmSounds(now) {
    if (!ONPU.audio) {
      return;
    }
    for (var i = 0; i < rhythmSoundQueue.length; i++) {
      var ev = rhythmSoundQueue[i];
      if (!ev.done && ev.time <= now + 0.15) {
        ev.done = true;
        if (ev.kind === "drum" && typeof ONPU.audio.playDrum === "function") {
          ONPU.audio.playDrum(ev.time);
        } else if (ev.kind === "note" && typeof ONPU.audio.playNoteAt === "function") {
          ONPU.audio.playNoteAt(ev.note, ev.time, ev.duration, ev.volume);
        }
      }
    }
  }

  // 1問の判定を行い、点・吹き出し・メロディを出して結果のあとのボタンを予約する
  function finishRhythmRound() {
    if (rhythmRafId !== null) {
      cancelAnimationFrame(rhythmRafId);
      rhythmRafId = null;
    }
    rhythmState = "result";
    setActiveRhythmCard(-1);
    setRhythmLead(getText("rhythm.lead"), false);
    resetRhythmDots();

    if (!ONPU.rhythm || typeof ONPU.rhythm.judge !== "function") {
      return;
    }
    var win = (ONPU.config && ONPU.config.rhythmWindow)
      ? ONPU.config.rhythmWindow
      : { perfect: 0.15, good: 0.30 };
    var res = ONPU.rhythm.judge(rhythmPattern, rhythmBpm, rhythmTaps, {
      perfect: win.perfect,
      good: win.good,
      offset: rhythmLat
    });
    var resultKey = res ? res.result : "retry";
    rhythmLastResult = resultKey;

    if (res) {
      for (var i = 0; i < res.notes.length; i++) {
        (function (idx, grade) {
          var applyDot = function () {
            var dot = rhythmDotEls[idx];
            if (!dot) {
              return;
            }
            dot.className = "rhythm-dot " + grade;
            restartClass(dot, "pop");
          };
          if (idx === 0) {
            applyDot();
          } else {
            var tid = setTimeout(applyDot, idx * 120);
            rhythmDotTimers.push(tid);
          }
        })(i, res.notes[i].grade);
      }

      var bubbleEl = document.getElementById("rhythm-bubble");
      if (bubbleEl) {
        bubbleEl.textContent = getText("rhythm.result." + res.result);
        bubbleEl.hidden = false;
        restartClass(bubbleEl, "pop");
      }

      if (res.result === "pittari" && ONPU.audio && typeof ONPU.audio.playMelody === "function") {
        var melodyKey = (ONPU.music && typeof ONPU.music.pickCorrectKey === "function")
          ? ONPU.music.pickCorrectKey(lastCorrectKey)
          : "correct";
        ONPU.audio.playMelody(melodyKey);
        lastCorrectKey = melodyKey;
      }
    }

    rhythmFlowTimerId = setTimeout(function () {
      rhythmFlowTimerId = null;
      var retryBtn = document.getElementById("btn-rhythm-retry");
      var nextBtn = document.getElementById("btn-rhythm-next");
      var retryable = typeof ONPU.rhythm.canRetry === "function" && ONPU.rhythm.canRetry(resultKey, rhythmAttempt);
      if (retryable) {
        if (retryBtn) {
          retryBtn.className = "rhythm-flow-btn";
          retryBtn.hidden = false;
        }
        if (nextBtn) {
          nextBtn.className = "rhythm-flow-btn sub";
          nextBtn.hidden = false;
        }
      } else {
        if (retryBtn) {
          retryBtn.hidden = true;
        }
        if (nextBtn) {
          nextBtn.className = "rhythm-flow-btn";
          nextBtn.hidden = false;
        }
      }
    }, 600);
  }

  // requestAnimationFrame で音の予約と画面の表示を進める
  function tickRhythm() {
    rhythmRafId = null;
    var now = (ONPU.audio && typeof ONPU.audio.now === "function") ? ONPU.audio.now() : null;
    if (now === null) {
      stopRhythmRound();
      return;
    }

    scheduleDueRhythmSounds(now);

    if (now >= rhythmStart + 4 * rhythmBeatSec + rhythmLat + 0.4) {
      finishRhythmRound();
      return;
    }

    var viewNow = now - rhythmLat;
    var modelEnd = rhythmBase + 4 * rhythmBeatSec;
    var tapEnd = rhythmStart + 4 * rhythmBeatSec;

    if (viewNow < modelEnd - 1e-9) {
      rhythmState = "model";
      setRhythmLead(getText(rhythmAttempt === 2 ? "rhythm.listen.again" : "rhythm.listen"), false);
      if (viewNow >= rhythmBase - 1e-9) {
        var modelCardIdx = ONPU.rhythm.cardIndexAt(rhythmPattern, rhythmBpm, viewNow - rhythmBase);
        setActiveRhythmCard(modelCardIdx);
        if (rhythmModelTimeline && Array.isArray(rhythmModelTimeline.hits)) {
          for (var k = 0; k < rhythmModelTimeline.hits.length; k++) {
            if (viewNow + 1e-9 >= rhythmModelTimeline.hits[k] && rhythmDotEls[k]) {
              rhythmDotEls[k].classList.add("model");
            }
          }
        }
      } else {
        setActiveRhythmCard(-1);
      }
    } else if (viewNow < rhythmStart - 1e-9) {
      rhythmState = "count";
      setActiveRhythmCard(-1);
      for (var d = 0; d < rhythmDotEls.length; d++) {
        rhythmDotEls[d].classList.remove("model");
      }
      var beatNum = Math.floor((viewNow - modelEnd + 1e-9) / rhythmBeatSec) + 1;
      if (beatNum < 1) {
        beatNum = 1;
      } else if (beatNum > 4) {
        beatNum = 4;
      }
      setRhythmLead(getText("rhythm.count", { count: beatNum }), true);
    } else {
      rhythmState = "tap";
      for (var d2 = 0; d2 < rhythmDotEls.length; d2++) {
        rhythmDotEls[d2].classList.remove("model");
      }
      if (viewNow < tapEnd - 1e-9) {
        var tapBeatNum = Math.floor((viewNow - rhythmStart + 1e-9) / rhythmBeatSec) + 1;
        if (tapBeatNum < 1) {
          tapBeatNum = 1;
        } else if (tapBeatNum > 4) {
          tapBeatNum = 4;
        }
        setRhythmLead(getText("rhythm.go"), false, tapBeatNum);
        var tapCardIdx = ONPU.rhythm.cardIndexAt(rhythmPattern, rhythmBpm, viewNow - rhythmStart);
        setActiveRhythmCard(tapCardIdx);
      } else {
        setRhythmLead(getText("rhythm.go"), false);
        setActiveRhythmCard(-1);
      }
    }

    rhythmRafId = requestAnimationFrame(tickRhythm);
  }

  // 今の問題をお手本から始める
  function startRhythmPlayback() {
    stopRhythmRound();
    if (!ONPU.rhythm || !ONPU.audio || typeof ONPU.audio.now !== "function") {
      return;
    }
    var now = ONPU.audio.now();
    if (now === null) {
      return;
    }
    var info = typeof ONPU.audio.getLatency === "function" ? ONPU.audio.getLatency() : null;
    rhythmLat = info ? ONPU.rhythm.latencyFrom(info.base, info.output) : 0;
    rhythmPattern = rhythmQuestions[rhythmQIndex] || [];
    rhythmBpm = (ONPU.rhythm.SPEEDS && ONPU.rhythm.SPEEDS[rhythmSpeedKey]) ? ONPU.rhythm.SPEEDS[rhythmSpeedKey] : 60;
    rhythmBeatSec = 60 / rhythmBpm;
    rhythmBase = now + 0.3;
    rhythmStart = rhythmBase + 8 * rhythmBeatSec;

    rhythmModelTimeline = ONPU.rhythm.timeline(rhythmPattern, rhythmBpm, rhythmBase);
    var countTimes = ONPU.rhythm.countInTimes(rhythmBpm, rhythmStart);
    var tapTimes = ONPU.rhythm.tapBeatTimes(rhythmBpm, rhythmStart);

    rhythmSoundQueue = [];
    if (rhythmModelTimeline && Array.isArray(rhythmModelTimeline.hits)) {
      for (var i = 0; i < rhythmModelTimeline.hits.length; i++) {
        rhythmSoundQueue.push({
          time: rhythmModelTimeline.hits[i],
          kind: "drum",
          done: false
        });
      }
    }
    for (var j = 0; j < countTimes.length; j++) {
      rhythmSoundQueue.push({
        time: countTimes[j],
        kind: "note",
        note: j === 0 ? "C6" : "C5",
        duration: 0.1,
        done: false
      });
    }
    for (var m = 0; m < tapTimes.length; m++) {
      rhythmSoundQueue.push({
        time: tapTimes[m],
        kind: "note",
        note: m === 0 ? "C6" : "C5",
        duration: 0.1,
        volume: ONPU.rhythm.TAP_BEAT_VOLUME,
        done: false
      });
    }

    rhythmTaps = [];
    rhythmState = "model";
    setRhythmLead(getText(rhythmAttempt === 2 ? "rhythm.listen.again" : "rhythm.listen"), false);
    scheduleDueRhythmSounds(now);
    rhythmRafId = requestAnimationFrame(tickRhythm);
  }

  // リズムの森の1回（5問）を始める
  function startRhythmSession(lv) {
    if (!lv || !ONPU.rhythm) {
      return;
    }
    stopQuizTimer();
    stopRhythmRound();
    rhythmLevel = lv;
    rhythmQuestions = ONPU.rhythm.pickPatterns(lv.pool, ONPU.rhythm.QUESTION_COUNT);
    rhythmQIndex = 0;
    rhythmAttempt = 1;
    rhythmResults = [];
    rhythmLastResult = null;
    updateRhythmSpeedButton();
    renderRhythmPattern();
    showScreen("screen-rhythm");
    rhythmAutoTimerId = setTimeout(function () {
      rhythmAutoTimerId = null;
      startRhythmPlayback();
    }, 600);
  }

  // 初期化
  function init() {
    buildSoundKeys();
    applyTexts();
    selectClef("treble");
    updateStageScale();

    window.addEventListener("resize", updateStageScale);
    window.addEventListener("orientationchange", updateStageScale);

    // レベルを選ぶ画面の記号タブ
    bindButton("btn-clef-treble", function () {
      selectClef("treble");
    });
    bindButton("btn-clef-bass", function () {
      selectClef("bass");
    });

    // はじめるボタン → 音の準備をして地図画面へ
    bindButton("btn-start", function () {
      if (ONPU.audio && typeof ONPU.audio.unlock === "function") {
        ONPU.audio.unlock();
      }
      showScreen("screen-map");
    });

    // 歯車ボタン → おうちの方の画面へ
    bindButton("btn-settings", function () {
      showScreen("screen-settings");
    });

    // もどるボタン → 地図画面へ
    bindButton("btn-settings-back", function () {
      showScreen("screen-map");
    });

    // おとの たしかめボタン群
    bindSoundButtons();

    // ドレミの島 → レベルを選ぶ画面へ
    bindButton("island-doremi", function () {
      openLevelScreen("doremi");
    });

    // リズムの森 → レベルを選ぶ画面へ
    bindButton("island-rhythm", function () {
      openLevelScreen("rhythm");
    });

    // リズムの森「ちずへ」 → 進めている1問を止め、1回の記録を捨てて地図にもどる
    bindButton("btn-rhythm-map", function () {
      stopRhythmRound();
      clearRhythmSession();
      showScreen("screen-map");
    });

    // リズムの森「おてほん」 → いつ押しても、進めている1問を止めて同じ問題をお手本から始め直す
    bindButton("btn-rhythm-model", function () {
      startRhythmPlayback();
    });

    // リズムの森「はやさ」 → いつ押しても、進めている1問を止めて速さを変え、同じ問題をお手本から始め直す
    bindButton("btn-rhythm-speed", function () {
      var idx = RHYTHM_SPEED_ORDER.indexOf(rhythmSpeedKey);
      rhythmSpeedKey = RHYTHM_SPEED_ORDER[(idx + 1) % RHYTHM_SPEED_ORDER.length];
      updateRhythmSpeedButton();
      startRhythmPlayback();
    });

    // リズムの森［もういちど］ → 結果のあとだけ受け付け、同じ問題を2回目としてお手本から始める
    bindButton("btn-rhythm-retry", function () {
      var retryBtn = document.getElementById("btn-rhythm-retry");
      if (rhythmState !== "result" || !retryBtn || retryBtn.hidden) {
        return;
      }
      rhythmAttempt = 2;
      stopRhythmRound();
      rhythmAutoTimerId = setTimeout(function () {
        rhythmAutoTimerId = null;
        startRhythmPlayback();
      }, 600);
    });

    // リズムの森［つぎへ］ → 結果のあとだけ受け付け、結果を記録して次の問題またはクリア画面へ進む
    bindButton("btn-rhythm-next", function () {
      var nextBtn = document.getElementById("btn-rhythm-next");
      if (rhythmState !== "result" || !nextBtn || nextBtn.hidden) {
        return;
      }
      rhythmResults[rhythmQIndex] = rhythmLastResult;
      stopRhythmRound();
      if (rhythmQIndex + 1 >= rhythmQuestions.length) {
        showRhythmClearScreen();
        return;
      }
      rhythmQIndex += 1;
      rhythmAttempt = 1;
      renderRhythmPattern();
      rhythmAutoTimerId = setTimeout(function () {
        rhythmAutoTimerId = null;
        startRhythmPlayback();
      }, 600);
    });

    // リズムの森「ドン！」 → pointerdown で今すぐたいこを鳴らし、カウント・たたく状態のとき時刻を記録する
    var donBtn = document.getElementById("btn-rhythm-don");
    if (donBtn) {
      donBtn.addEventListener("pointerdown", function (e) {
        if (e.button !== undefined && e.button !== 0) {
          return;
        }
        e.preventDefault();
        donBtn.classList.add("pressed");
        if (ONPU.audio && typeof ONPU.audio.playDrum === "function") {
          ONPU.audio.playDrum();
        }
        if ((rhythmState === "count" || rhythmState === "tap") && ONPU.audio && typeof ONPU.audio.now === "function") {
          var tapNow = ONPU.audio.now();
          if (tapNow !== null) {
            var rel = tapNow - rhythmStart;
            if (rel >= -0.5 * rhythmBeatSec) {
              rhythmTaps.push(rel);
            }
          }
        }
      });
      var clearDonPressed = function () {
        donBtn.classList.remove("pressed");
      };
      donBtn.addEventListener("pointerup", clearDonPressed);
      donBtn.addEventListener("pointerleave", clearDonPressed);
      donBtn.addEventListener("pointercancel", clearDonPressed);
    }

    // 画面が隠れたとき → リズムの森の進行中（お手本・カウント・たたく）のときだけ止める
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") {
        var rhythmScreen = document.getElementById("screen-rhythm");
        if (
          rhythmScreen &&
          rhythmScreen.classList.contains("active") &&
          (rhythmState === "model" || rhythmState === "count" || rhythmState === "tap")
        ) {
          stopRhythmRound();
        }
      }
    });

    // レベルを選ぶ画面「ちずへ」 → 地図にもどる
    bindButton("btn-level-map", function () {
      stopQuizTimer();
      showScreen("screen-map");
    });

    // 問題の画面「ちずへ」 → 進めている問題をやめて地図にもどる
    bindButton("btn-quiz-map", function () {
      stopQuizTimer();
      currentSession = null;
      showScreen("screen-map");
    });

    // 問題の画面「おとを きく」 → 今の問題の音を鳴らす
    bindButton("btn-quiz-listen", function () {
      if (waitingNext || !currentSession || currentSession.finished || !ONPU.quiz) {
        return;
      }
      var q = ONPU.quiz.current(currentSession);
      if (q === null) {
        return;
      }
      if (earTimerId !== null) {
        clearTimeout(earTimerId);
        earTimerId = null;
      }
      playCurrentQuestionSound(q);
    });

    // クリア画面「もういちど」 → 同じレベルをはじめからやり直す
    bindButton("btn-clear-retry", function () {
      if (clearKind === "rhythm") {
        if (rhythmLevel) {
          startRhythmSession(rhythmLevel);
        }
      } else if (currentIslandKey) {
        startQuiz(currentIslandKey, currentLevel);
      }
    });

    // クリア画面「つぎの しまへ」 → 地図にもどる
    bindButton("btn-clear-next", function () {
      stopQuizTimer();
      stopRhythmRound();
      currentSession = null;
      clearRhythmSession();
      showScreen("screen-map");
    });

    // 準備中の案内を出すボタン群
    var preparingIds = [
      "island-puzzle",
      "btn-stamp",
      "btn-instruments"
    ];
    for (var i = 0; i < preparingIds.length; i++) {
      bindButton(preparingIds[i], function () {
        showToast(getText("common.preparing"));
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
