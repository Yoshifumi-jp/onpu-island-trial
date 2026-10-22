window.ONPU = window.ONPU || {};

// 島に共通の出題・正誤判定・★の計算（画面や音の処理は含めない）
(function () {
  "use strict";

  // 整数かどうかを判定する
  function isInt(n) {
    return typeof n === "number" && isFinite(n) && Math.floor(n) === n;
  }

  // 正解数と問題数から★の数（0〜3）を計算して返す
  function calcStars(correct, total) {
    if (!isInt(total) || total < 1) {
      return 0;
    }
    if (!isInt(correct) || correct < 0 || correct > total) {
      return 0;
    }
    if (correct * 10 >= total * 9) {
      return 3;
    }
    if (correct * 10 >= total * 8) {
      return 2;
    }
    if (correct * 10 >= total * 6) {
      return 1;
    }
    return 0;
  }

  // 出題の範囲 pool から count 問を選び、同じ音が続けて出ないように配列で返す
  function makeQuestions(pool, count, rng) {
    if (!Array.isArray(pool) || pool.length === 0) {
      return [];
    }
    if (!isInt(count) || count < 1) {
      return [];
    }
    var randomFn = typeof rng === "function" ? rng : Math.random;
    var questions = [];
    for (var k = 0; k < count; k++) {
      var i = Math.floor(randomFn() * pool.length);
      if (isNaN(i) || i < 0 || i >= pool.length) {
        i = 0;
      }
      if (pool.length > 1 && k > 0 && pool[i] === questions[k - 1]) {
        i = (i + 1) % pool.length;
      }
      questions.push(pool[i]);
    }
    return questions;
  }

  // 1回分の問題の記録（セッション）を作って返す
  // options.retry === true のときだけ、まちがえた音を同じ回のあとの問題でもう一度出す
  function createSession(questions, answerOf, options) {
    var list = Array.isArray(questions) ? questions.slice() : [];
    return {
      questions: list,
      answerOf: answerOf,
      index: 0,
      correct: 0,
      results: [],
      finished: list.length === 0,
      streak: 0,          // 今つづけて正解している数
      retry: !!(options && options.retry === true), // 出し直しをするかどうか
      retried: {},        // 出し直しをした音名（音名: true）
      retrySlots: {}      // 出し直しで入れ替えた位置（番号: true）
    };
  }

  // まちがえた位置 i の音を出し直す位置を決めて入れ替える。入れた位置の番号を返し、入れなければ null を返す
  function scheduleRetry(session, i) {
    var questions = session.questions;
    var n = questions.length;
    var x = questions[i];
    if (!session.retried || typeof session.retried !== "object") {
      session.retried = {};
    }
    if (!session.retrySlots || typeof session.retrySlots !== "object") {
      session.retrySlots = {};
    }
    // 同じ音は1回の中で1回まで
    if (Object.prototype.hasOwnProperty.call(session.retried, x)) {
      return null;
    }
    // あとにすでに同じ音があれば出し直さない
    for (var k = i + 1; k < n; k++) {
      if (questions[k] === x) {
        return null;
      }
    }
    // 候補は i+3、i+4、…、n−1、最後に i+2 の順（i+1 は使わない）
    var candidates = [];
    for (var c = i + 3; c <= n - 1; c++) {
      candidates.push(c);
    }
    if (i + 2 <= n - 1) {
      candidates.push(i + 2);
    }
    for (var m = 0; m < candidates.length; m++) {
      var t = candidates[m];
      if (!Object.prototype.hasOwnProperty.call(session.retrySlots, t)) {
        questions[t] = x;
        session.retried[x] = true;
        session.retrySlots[t] = true;
        return t;
      }
    }
    return null;
  }

  // 今の問題（音名）を返す。終わっていれば null を返す
  function current(session) {
    if (
      !session ||
      session.finished ||
      !Array.isArray(session.questions) ||
      session.index < 0 ||
      session.index >= session.questions.length
    ) {
      return null;
    }
    return session.questions[session.index];
  }

  // 今の問題に答えて正誤を記録し、結果を返す。終わったあとや不正なときは null を返す
  function submit(session, answer) {
    if (
      !session ||
      session.finished ||
      !Array.isArray(session.questions) ||
      session.index < 0 ||
      session.index >= session.questions.length
    ) {
      return null;
    }
    var question = session.questions[session.index];
    var correctAnswer = typeof session.answerOf === "function" ? session.answerOf(question) : null;
    var isCorrect = answer === correctAnswer;

    if (isCorrect) {
      session.correct += 1;
    }
    if (!Array.isArray(session.results)) {
      session.results = [];
    }
    session.results.push({
      question: question,
      answer: answer,
      isCorrect: isCorrect
    });

    // 連続正解の数（正解で1増やし、まちがいで 0 に戻す）
    var prevStreak = isInt(session.streak) ? session.streak : 0;
    session.streak = isCorrect ? prevStreak + 1 : 0;

    // まちがえたときの出し直し
    var retryAt = null;
    if (!isCorrect && session.retry === true) {
      retryAt = scheduleRetry(session, session.index);
    }

    session.index += 1;
    if (session.index >= session.questions.length) {
      session.finished = true;
    }

    return {
      isCorrect: isCorrect,
      correctAnswer: correctAnswer,
      finished: session.finished,
      streak: session.streak,
      retryAt: retryAt
    };
  }

  ONPU.quiz = {
    calcStars: calcStars,
    makeQuestions: makeQuestions,
    createSession: createSession,
    current: current,
    submit: submit
  };
})();

