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

  // レベルを選ぶ画面のカード4つを作って動作を登録する
  function buildLevelCards() {
    var container = document.getElementById("level-cards");
    if (!container || !ONPU.music || !Array.isArray(ONPU.music.LEVELS)) {
      return;
    }
    container.innerHTML = "";
    for (var i = 0; i < ONPU.music.LEVELS.length; i++) {
      var lv = ONPU.music.LEVELS[i];
      var btn = document.createElement("button");
      btn.type = "button";
      btn.id = "btn-level-" + lv.level;
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

      (function (levelInfo) {
        bindButton("btn-level-" + levelInfo.level, function () {
          startQuiz("doremi", levelInfo);
        });
      })(lv);
    }
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
      var cy = ONPU.music.staffY(q);
      var ledger = ONPU.music.needsLedger(q);
      var up = ONPU.music.stemUp(q);

      var ledgerEl = document.getElementById("quiz-ledger");
      if (ledgerEl) {
        ledgerEl.style.display = ledger ? "" : "none";
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
    var hintEl = document.getElementById("quiz-hint");
    if (hintEl) {
      hintEl.textContent = getText(isEar ? island.earHintTextId : island.hintTextId);
      hintEl.classList.remove("streak", "streak-s", "streak-m", "streak-l", "hint-pop", "hint-pulse");
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

  // 初期化
  function init() {
    buildSoundKeys();
    applyTexts();
    buildLevelCards();
    updateStageScale();

    window.addEventListener("resize", updateStageScale);
    window.addEventListener("orientationchange", updateStageScale);

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
      stopQuizTimer();
      showScreen("screen-level");
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
      if (currentIslandKey) {
        startQuiz(currentIslandKey, currentLevel);
      }
    });

    // クリア画面「つぎの しまへ」 → 地図にもどる
    bindButton("btn-clear-next", function () {
      stopQuizTimer();
      currentSession = null;
      showScreen("screen-map");
    });

    // 準備中の案内を出すボタン群
    var preparingIds = [
      "island-rhythm",
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
