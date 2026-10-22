window.ONPU = window.ONPU || {};

// 音の高さの計算とメロディのデータ（画面や音を出す処理は含めない）
(function () {
  "use strict";

  // C4〜C6 の音名と MIDI 番号の対応表（シャープ・フラットは使わない）
  var MIDI_MAP = {
    C4: 60,
    D4: 62,
    E4: 64,
    F4: 65,
    G4: 67,
    A4: 69,
    B4: 71,
    C5: 72,
    D5: 74,
    E5: 76,
    F5: 77,
    G5: 79,
    A5: 81,
    B5: 83,
    C6: 84
  };

  // 音名（"C4"〜"C6"）を周波数（Hz）にして返す。対応しない音名は null を返す
  function noteToFrequency(name) {
    if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(MIDI_MAP, name)) {
      return null;
    }
    var midi = MIDI_MAP[name];
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // 鍵盤8つの並び
  var KEYS = [
    { name: "C4", textId: "note.c4", color: "#FF9A8F" },
    { name: "D4", textId: "note.d4", color: "#FFBE7D" },
    { name: "E4", textId: "note.e4", color: "#FFE27A" },
    { name: "F4", textId: "note.f4", color: "#A8E395" },
    { name: "G4", textId: "note.g4", color: "#8FDCEB" },
    { name: "A4", textId: "note.a4", color: "#AFC2FF" },
    { name: "B4", textId: "note.b4", color: "#DAB4F7" },
    { name: "C5", textId: "note.c5", color: "#FF9A8F" }
  ];

  // メロディのデータ
  var MELODIES = {
    // 正解のときの音
    correct: { tempo: 180, notes: [
      { name: "C5", beats: 0.5 }, { name: "E5", beats: 0.5 }, { name: "G5", beats: 1 }
    ] },
    // クリアのときの音
    clear: { tempo: 160, notes: [
      { name: "C5", beats: 0.5 }, { name: "E5", beats: 0.5 }, { name: "G5", beats: 0.5 },
      { name: "C6", beats: 1 }, { name: null, beats: 0.5 },
      { name: "G5", beats: 0.5 }, { name: "C6", beats: 1.5 }
    ] },
    // 島がひらくときの音
    unlock: { tempo: 160, notes: [
      { name: "C5", beats: 0.25 }, { name: "D5", beats: 0.25 }, { name: "E5", beats: 0.25 },
      { name: "F5", beats: 0.25 }, { name: "G5", beats: 0.25 }, { name: "A5", beats: 0.25 },
      { name: "B5", beats: 0.25 }, { name: "C6", beats: 1 }
    ] },
    // 正解のときの音 その2「ぴょん」
    correct2: { tempo: 180, notes: [
      { name: "E5", beats: 0.25 }, { name: "G5", beats: 0.25 }, { name: "C6", beats: 1 }
    ] },
    // 正解のときの音 その3「はずむ」
    correct3: { tempo: 180, notes: [
      { name: "G5", beats: 0.5 }, { name: "E5", beats: 0.25 }, { name: "G5", beats: 0.25 }, { name: "C6", beats: 1 }
    ] },
    // 正解のときの音 その4「ファラド」
    correct4: { tempo: 180, notes: [
      { name: "F5", beats: 0.5 }, { name: "A5", beats: 0.5 }, { name: "C6", beats: 1 }
    ] }
  };

  // 正解のときに鳴らすメロディの名前の一覧
  var CORRECT_KEYS = ["correct", "correct2", "correct3", "correct4"];

  // 前に鳴らしたメロディ（prevKey）を除いた中から、正解のメロディの名前を1つ選んで返す
  function pickCorrectKey(prevKey, rng) {
    var randomFn = typeof rng === "function" ? rng : Math.random;
    var choices = [];
    for (var i = 0; i < CORRECT_KEYS.length; i++) {
      if (CORRECT_KEYS[i] !== prevKey) {
        choices.push(CORRECT_KEYS[i]);
      }
    }
    var idx = Math.floor(randomFn() * choices.length);
    if (isNaN(idx) || idx < 0 || idx >= choices.length) {
      idx = 0;
    }
    return choices[idx];
  }

  // たいこの音の数値（docs/dev/design/drum_samples.html の候補 B）
  var DRUM = {
    body: { type: "sine", f0: 260, f1: 110, sweep: 0.18, gain: 1.0, decay: 0.45, attack: 0.002 }, // 胴の音
    over: { type: "triangle", ratio: 2.0, gain: 0.3, decay: 0.2 },  // 重ねる倍音
    hit:  { freq: 1800, q: 0.8, gain: 0.3, decay: 0.035 }           // バチが当たる音（雑音を帯域で絞る）
  };

  // メロディを鳴らす予定の表にして返す
  function toSchedule(melody) {
    if (!melody || !melody.tempo || !Array.isArray(melody.notes)) {
      return { events: [], total: 0 };
    }
    var beatSec = 60 / melody.tempo;
    var events = [];
    var currentBeats = 0;

    for (var i = 0; i < melody.notes.length; i++) {
      var note = melody.notes[i];
      var beats = note.beats;
      var start = currentBeats * beatSec;
      var duration = beats * beatSec;

      if (note.name !== null) {
        var freq = noteToFrequency(note.name);
        if (freq !== null) {
          events.push({
            name: note.name,
            frequency: freq,
            start: start,
            duration: duration
          });
        }
      }
      currentBeats += beats;
    }

    return {
      events: events,
      total: currentBeats * beatSec
    };
  }

  // ドレミの答えの7つのボタンの並び
  var ANSWERS = [
    { id: "do", textId: "note.c4", note: "C4", color: "#FF9A8F" },
    { id: "re", textId: "note.d4", note: "D4", color: "#FFBE7D" },
    { id: "mi", textId: "note.e4", note: "E4", color: "#FFE27A" },
    { id: "fa", textId: "note.f4", note: "F4", color: "#A8E395" },
    { id: "so", textId: "note.g4", note: "G4", color: "#8FDCEB" },
    { id: "la", textId: "note.a4", note: "A4", color: "#AFC2FF" },
    { id: "si", textId: "note.b4", note: "B4", color: "#DAB4F7" }
  ];

  // 音名の先頭の英字と答えの id の対応表
  var ANSWER_MAP = {
    C: "do",
    D: "re",
    E: "mi",
    F: "fa",
    G: "so",
    A: "la",
    B: "si"
  };

  // 音名の先頭の英字で答えの id を返す（対応しない音名は null）
  function answerOf(name) {
    if (noteToFrequency(name) === null) {
      return null;
    }
    var head = name.charAt(0);
    return Object.prototype.hasOwnProperty.call(ANSWER_MAP, head) ? ANSWER_MAP[head] : null;
  }

  // 五線の段の表（下の線のミ＝0、線と間で1段）
  var STAFF_STEPS = {
    C4: -2,
    D4: -1,
    E4: 0,
    F4: 1,
    G4: 2,
    A4: 3,
    B4: 4,
    C5: 5,
    D5: 6,
    E5: 7,
    F5: 8,
    G5: 9
  };

  // 五線の段を取り出す（表にない音名は null）
  function getStaffStep(name) {
    if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(STAFF_STEPS, name)) {
      return null;
    }
    return STAFF_STEPS[name];
  }

  // 音符の中心の y（カードの内側の座標）を返す（表にない音名は null）
  function staffY(name) {
    var step = getStaffStep(name);
    if (step === null) {
      return null;
    }
    return 280 - step * 16;
  }

  // 加線が要るとき true、それ以外は false（表にない音名は null）
  function needsLedger(name) {
    var step = getStaffStep(name);
    if (step === null) {
      return null;
    }
    return step <= -2 || step >= 10;
  }

  // ぼうが上向きなら true（段が 4 より下なら true、4 以上なら false。表にない音名は null）
  function stemUp(name) {
    var step = getStaffStep(name);
    if (step === null) {
      return null;
    }
    return step < 4;
  }

  // ドレミの島のレベルの表
  var LEVELS = [
    { level: 1, textId: "doremi.level1", color: "#FF9A8F", mode: "staff", pool: ["C4", "D4", "E4", "F4", "G4"] },
    { level: 2, textId: "doremi.level2", color: "#FFE27A", mode: "staff", pool: ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"] },
    { level: 3, textId: "doremi.level3", color: "#8FDCEB", mode: "staff", pool: ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5", "D5", "E5", "F5", "G5"] },
    { level: 4, textId: "doremi.level4", color: "#DAB4F7", mode: "ear",   pool: ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"] }
  ];

  // レベル4 で鳴らす音の予定を返す（先にド、0.9秒後に問題の音）
  function earSequence(name) {
    if (noteToFrequency(name) === null) {
      return [];
    }
    return [
      { name: "C4", start: 0, duration: 0.6 },
      { name: name, start: 0.9, duration: 0.6 }
    ];
  }

  ONPU.music = {
    noteToFrequency: noteToFrequency,
    KEYS: KEYS,
    MELODIES: MELODIES,
    CORRECT_KEYS: CORRECT_KEYS,
    pickCorrectKey: pickCorrectKey,
    DRUM: DRUM,
    toSchedule: toSchedule,
    ANSWERS: ANSWERS,
    answerOf: answerOf,
    staffY: staffY,
    needsLedger: needsLedger,
    stemUp: stemUp,
    LEVELS: LEVELS,
    earSequence: earSequence
  };
})();

