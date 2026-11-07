window.ONPU = window.ONPU || {};

// リズムの森のリズム判定と時刻の計算（画面や音の処理は含めない）
(function () {
  "use strict";

  // 小数の計算誤差で境目がずれないようにする余裕
  var EPS = 1e-9;

  // リズムカード（1小節＝4拍）
  var CARDS = {
    ta: { beats: 1, hits: [0] },
    titi: { beats: 1, hits: [0, 0.5] },
    un: { beats: 1, hits: [] },
    taan: { beats: 2, hits: [0] }
  };

  // 速さ（BPM＝1分間の拍の数）
  var SPEEDS = {
    slow: 60,
    normal: 80,
    fast: 100
  };

  // 判定の幅（秒）
  var DEFAULT_WINDOW = {
    perfect: 0.10,
    good: 0.20
  };

  // 音の遅れの上限（秒）
  var MAX_LATENCY = 0.25;

  // 1回の問題数
  var QUESTION_COUNT = 5;

  // 1問ごとの点数
  var POINTS = {
    pittari: 20,
    oshii: 10,
    retry: 0
  };

  // レベルごとの問題の並び
  var LEVELS = [
    {
      level: 1,
      textId: "rhythm.level1",
      color: "#FF9A8F",
      pool: [
        ["ta", "ta", "ta", "un"],
        ["ta", "ta", "un", "ta"],
        ["ta", "ta", "un", "un"],
        ["ta", "un", "ta", "ta"],
        ["ta", "un", "ta", "un"],
        ["ta", "un", "un", "ta"],
        ["ta", "un", "un", "un"]
      ]
    },
    {
      level: 2,
      textId: "rhythm.level2",
      color: "#FFE27A",
      pool: [
        ["ta", "ta", "ta", "titi"],
        ["ta", "ta", "titi", "ta"],
        ["ta", "ta", "titi", "titi"],
        ["ta", "titi", "ta", "ta"],
        ["ta", "titi", "ta", "titi"],
        ["ta", "titi", "titi", "ta"],
        ["ta", "titi", "titi", "titi"]
      ]
    },
    {
      level: 3,
      textId: "rhythm.level3",
      color: "#8FDCEB",
      pool: [
        ["ta", "ta", "titi", "un"],
        ["ta", "ta", "un", "titi"],
        ["ta", "titi", "ta", "un"],
        ["ta", "titi", "titi", "un"],
        ["ta", "titi", "un", "ta"],
        ["ta", "titi", "un", "titi"],
        ["ta", "titi", "un", "un"],
        ["ta", "un", "ta", "titi"],
        ["ta", "un", "titi", "ta"],
        ["ta", "un", "titi", "titi"],
        ["ta", "un", "titi", "un"],
        ["ta", "un", "un", "titi"]
      ]
    },
    {
      level: 4,
      textId: "rhythm.level4",
      color: "#DAB4F7",
      pool: [
        ["ta", "taan", "ta"],
        ["ta", "ta", "taan"],
        ["ta", "taan", "titi"],
        ["ta", "titi", "taan"],
        ["ta", "taan", "un"],
        ["ta", "un", "taan"]
      ]
    }
  ];

  // 0より大きい有限の数かどうかを判定する
  function isPositiveNumber(n) {
    return typeof n === "number" && isFinite(n) && n > 0;
  }

  // 有限の数かどうかを判定する
  function isFiniteNumber(n) {
    return typeof n === "number" && isFinite(n);
  }

  // カードの並びの拍の合計を返す。配列でない・知らない id があるときは 0 を返す
  function patternBeats(pattern) {
    if (!Array.isArray(pattern)) {
      return 0;
    }
    var total = 0;
    for (var i = 0; i < pattern.length; i++) {
      var id = pattern[i];
      if (typeof id !== "string" || !Object.prototype.hasOwnProperty.call(CARDS, id)) {
        return 0;
      }
      total += CARDS[id].beats;
    }
    return total;
  }

  // 正しい1小節（4拍、すべて知っている id、打つ音が1つ以上）かどうかを判定する
  function isValidPattern(pattern) {
    if (patternBeats(pattern) !== 4) {
      return false;
    }
    var hitCount = 0;
    for (var i = 0; i < pattern.length; i++) {
      hitCount += CARDS[pattern[i]].hits.length;
    }
    return hitCount > 0;
  }

  // 打つべきお手本の時刻（秒。1拍目の頭＝0）を早い順の配列で返す
  function expectedTimes(pattern, bpm) {
    if (!isValidPattern(pattern) || !isPositiveNumber(bpm)) {
      return [];
    }
    var secPerBeat = 60 / bpm;
    var times = [];
    var beatOffset = 0;
    for (var i = 0; i < pattern.length; i++) {
      var card = CARDS[pattern[i]];
      for (var j = 0; j < card.hits.length; j++) {
        times.push((beatOffset + card.hits[j]) * secPerBeat);
      }
      beatOffset += card.beats;
    }
    return times;
  }

  // 各カードの始まりの時刻（秒）の配列を返す
  function cardStartTimes(pattern, bpm) {
    if (!isValidPattern(pattern) || !isPositiveNumber(bpm)) {
      return [];
    }
    var secPerBeat = 60 / bpm;
    var times = [];
    var beatOffset = 0;
    for (var i = 0; i < pattern.length; i++) {
      times.push(beatOffset * secPerBeat);
      beatOffset += CARDS[pattern[i]].beats;
    }
    return times;
  }

  // お手本と打った時刻を比べて判定結果を返す
  function judge(pattern, bpm, taps, options) {
    var expected = expectedTimes(pattern, bpm);
    if (expected.length === 0) {
      return null;
    }

    var perfect = DEFAULT_WINDOW.perfect;
    var good = DEFAULT_WINDOW.good;
    if (
      options &&
      typeof options.perfect === "number" &&
      typeof options.good === "number" &&
      isFinite(options.perfect) &&
      isFinite(options.good) &&
      options.perfect > 0 &&
      options.perfect <= options.good
    ) {
      perfect = options.perfect;
      good = options.good;
    }

    var offset =
      options && typeof options.offset === "number" && isFinite(options.offset)
        ? options.offset
        : 0;

    // 数（number）かつ NaN でないものだけを取り出し、offset を引いて小さい順に並べる
    var cleanTaps = [];
    if (Array.isArray(taps)) {
      for (var i = 0; i < taps.length; i++) {
        var t = taps[i];
        if (typeof t === "number" && isFinite(t)) {
          cleanTaps.push(t - offset);
        }
      }
    }
    cleanTaps.sort(function (a, b) {
      return a - b;
    });

    // 1. 各 tap をいちばん近いお手本の時刻に割り当てる（同じ近さなら前の音）
    var assigned = [];
    for (var n = 0; n < expected.length; n++) {
      assigned.push([]);
    }
    for (var k = 0; k < cleanTaps.length; k++) {
      var tapTime = cleanTaps[k];
      var bestIndex = 0;
      var bestDist = Math.abs(tapTime - expected[0]);
      for (var m = 1; m < expected.length; m++) {
        var dist = Math.abs(tapTime - expected[m]);
        if (dist < bestDist - EPS) {
          bestDist = dist;
          bestIndex = m;
        }
      }
      assigned[bestIndex].push(tapTime);
    }

    // 2. 各お手本の時刻について、good 以下のうちいちばん近い tap 1つを当たりにする
    var notes = [];
    var counts = {
      pittari: 0,
      oshii: 0,
      miss: 0
    };

    for (var idx = 0; idx < expected.length; idx++) {
      var targetTime = expected[idx];
      var bucket = assigned[idx];
      var hitTap = null;
      var hitDist = Infinity;

      for (var b = 0; b < bucket.length; b++) {
        var candidate = bucket[b];
        var d = Math.abs(candidate - targetTime);
        if (d <= good + EPS && d < hitDist - EPS) {
          hitTap = candidate;
          hitDist = d;
        }
      }

      if (hitTap !== null) {
        var diff = hitTap - targetTime;
        var grade = hitDist <= perfect + EPS ? "pittari" : "oshii";
        counts[grade] += 1;
        notes.push({
          time: targetTime,
          tap: hitTap,
          diff: diff,
          grade: grade
        });
      } else {
        counts.miss += 1;
        notes.push({
          time: targetTime,
          tap: null,
          diff: null,
          grade: "miss"
        });
      }
    }

    // 3. 当たりにならなかった tap はすべてよぶん（extras）と数える
    var hitTotal = counts.pittari + counts.oshii;
    var extras = cleanTaps.length - hitTotal;

    // 4. 全体の結果を決める
    var result;
    if (counts.miss === 0 && extras === 0 && counts.oshii <= 1) {
      result = "pittari";
    } else if (hitTotal * 10 >= expected.length * 6 && extras <= 1) {
      result = "oshii";
    } else {
      result = "retry";
    }

    return {
      result: result,
      notes: notes,
      counts: counts,
      extras: extras
    };
  }

  // 端末が知らせる音の遅れ（秒）を返す（上限 MAX_LATENCY）
  function latencyFrom(baseLatency, outputLatency) {
    var b = isPositiveNumber(baseLatency) ? baseLatency : 0;
    var o = isPositiveNumber(outputLatency) ? outputLatency : 0;
    return Math.min(MAX_LATENCY, b + o);
  }

  // 1小節を時刻 start（秒）から始めるときの時刻をまとめて返す
  function timeline(pattern, bpm, start) {
    if (!isValidPattern(pattern) || !isPositiveNumber(bpm) || !isFiniteNumber(start)) {
      return null;
    }
    var exp = expectedTimes(pattern, bpm);
    var starts = cardStartTimes(pattern, bpm);
    var hits = [];
    for (var i = 0; i < exp.length; i++) {
      hits.push(exp[i] + start);
    }
    var cardStarts = [];
    for (var j = 0; j < starts.length; j++) {
      cardStarts.push(starts[j] + start);
    }
    return {
      hits: hits,
      cardStarts: cardStarts,
      end: start + 4 * (60 / bpm)
    };
  }

  // start の前の4拍のカウントの時刻を返す
  function countInTimes(bpm, start) {
    if (!isPositiveNumber(bpm) || !isFiniteNumber(start)) {
      return [];
    }
    var secPerBeat = 60 / bpm;
    return [
      start - 4 * secPerBeat,
      start - 3 * secPerBeat,
      start - 2 * secPerBeat,
      start - 1 * secPerBeat
    ];
  }

  // 小節の頭からの経過 elapsed（秒）のときに鳴っているカードの番号（0 から）を返す
  function cardIndexAt(pattern, bpm, elapsed) {
    if (!isFiniteNumber(elapsed)) {
      return -1;
    }
    var starts = cardStartTimes(pattern, bpm);
    if (starts.length === 0) {
      return -1;
    }
    var end = 4 * (60 / bpm);
    if (elapsed < -EPS || elapsed >= end - EPS) {
      return -1;
    }
    for (var i = starts.length - 1; i >= 0; i--) {
      if (elapsed + EPS >= starts[i]) {
        return i;
      }
    }
    return -1;
  }

  // pool から重ならないように count 個を選び、順番も入れかえて返す
  function pickPatterns(pool, count, rng) {
    if (!Array.isArray(pool) || pool.length === 0) {
      return [];
    }
    if (typeof count !== "number" || !isFinite(count) || Math.floor(count) !== count || count < 1) {
      return [];
    }
    var n = pool.length;
    var indices = [];
    for (var i = 0; i < n; i++) {
      indices.push(i);
    }
    var randomFn = typeof rng === "function" ? rng : Math.random;
    for (var k = n - 1; k > 0; k--) {
      var j = Math.floor(randomFn() * (k + 1));
      if (typeof j === "number" && !isNaN(j) && j >= 0 && j <= k) {
        var tmp = indices[k];
        indices[k] = indices[j];
        indices[j] = tmp;
      }
    }
    var limit = count < n ? count : n;
    var result = [];
    for (var m = 0; m < limit; m++) {
      var item = pool[indices[m]];
      result.push(Array.isArray(item) ? item.slice() : item);
    }
    return result;
  }

  // 結果の配列から点数の合計（100点満点）を返す
  function scoreOf(results) {
    if (!Array.isArray(results)) {
      return 0;
    }
    var sum = 0;
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      if (typeof r === "string" && Object.prototype.hasOwnProperty.call(POINTS, r)) {
        sum += POINTS[r];
      }
    }
    return sum;
  }

  // 同じ問題をもう一度やり直せるかどうかを判定する
  function canRetry(result, attempt) {
    return (result === "oshii" || result === "retry") && attempt === 1;
  }

  ONPU.rhythm = {
    CARDS: CARDS,
    SPEEDS: SPEEDS,
    DEFAULT_WINDOW: DEFAULT_WINDOW,
    MAX_LATENCY: MAX_LATENCY,
    QUESTION_COUNT: QUESTION_COUNT,
    POINTS: POINTS,
    LEVELS: LEVELS,
    patternBeats: patternBeats,
    isValidPattern: isValidPattern,
    expectedTimes: expectedTimes,
    cardStartTimes: cardStartTimes,
    judge: judge,
    latencyFrom: latencyFrom,
    timeline: timeline,
    countInTimes: countInTimes,
    cardIndexAt: cardIndexAt,
    pickPatterns: pickPatterns,
    scoreOf: scoreOf,
    canRetry: canRetry
  };
})();
