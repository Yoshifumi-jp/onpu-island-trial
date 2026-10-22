window.ONPU = window.ONPU || {};

// Web Audio API で音を合成して鳴らす処理
(function () {
  "use strict";

  var audioCtx = null;
  var masterGain = null;
  var noiseBuffer = null;
  var audioUnavailable = false;

  // AudioContext とマスター音量（0.6）を用意し、一時停止中なら再開する
  function ensureContext(playSilent) {
    if (audioUnavailable) {
      return null;
    }
    try {
      var isNew = false;
      if (!audioCtx) {
        var CtxClass = window.AudioContext || window.webkitAudioContext;
        if (!CtxClass) {
          audioUnavailable = true;
          return null;
        }
        audioCtx = new CtxClass();
        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.6;
        masterGain.connect(audioCtx.destination);

        // バチの音に使う白色雑音（0.1秒）を1回だけ作って取っておく
        var sampleRate = audioCtx.sampleRate || 44100;
        noiseBuffer = audioCtx.createBuffer(1, Math.floor(sampleRate * 0.1), sampleRate);
        var data = noiseBuffer.getChannelData(0);
        for (var i = 0; i < data.length; i++) {
          data[i] = Math.random() * 2 - 1;
        }
        isNew = true;
      }
      if (audioCtx.state === "suspended") {
        var p = audioCtx.resume();
        if (p && typeof p.catch === "function") {
          p.catch(function () {});
        }
      }
      if (isNew && playSilent) {
        // iPhone・iPad 向けに、作った直後に長さ1サンプルの無音を1回鳴らす
        var buffer = audioCtx.createBuffer(1, 1, audioCtx.sampleRate || 22050);
        var source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(masterGain);
        source.start(0);
      }
      return audioCtx;
    } catch (e) {
      audioUnavailable = true;
      return null;
    }
  }

  // 音の準備（ボタン操作時に呼ぶ）
  function unlock() {
    ensureContext(true);
  }

  // 指定した時刻（startTime）と長さ（duration）でピアノ風の音を予約する
  function schedulePianoNote(ctx, freq, startTime, duration) {
    var endTime = startTime + duration + 0.6;

    // 音量のエンベロープ（0 → 0.005秒で 0.5 → duration+0.6秒で 0.001）
    var envGain = ctx.createGain();
    envGain.gain.setValueAtTime(0, startTime);
    envGain.gain.linearRampToValueAtTime(0.5, startTime + 0.005);
    envGain.gain.exponentialRampToValueAtTime(0.001, endTime);
    envGain.connect(masterGain);

    // 三角波（周波数どおり、音量 1.0）
    var oscTri = ctx.createOscillator();
    var gainTri = ctx.createGain();
    oscTri.type = "triangle";
    oscTri.frequency.setValueAtTime(freq, startTime);
    gainTri.gain.setValueAtTime(1.0, startTime);
    oscTri.connect(gainTri);
    gainTri.connect(envGain);

    // 正弦波（周波数の2倍、音量 0.25）
    var oscSine = ctx.createOscillator();
    var gainSine = ctx.createGain();
    oscSine.type = "sine";
    oscSine.frequency.setValueAtTime(freq * 2, startTime);
    gainSine.gain.setValueAtTime(0.25, startTime);
    oscSine.connect(gainSine);
    gainSine.connect(envGain);

    oscTri.start(startTime);
    oscSine.start(startTime);
    oscTri.stop(endTime);
    oscSine.stop(endTime);
  }

  // ピアノ風の1音を鳴らす（duration を省いたときは 0.5秒）
  function playNote(name, duration) {
    if (!ONPU.music || typeof ONPU.music.noteToFrequency !== "function") {
      return;
    }
    var freq = ONPU.music.noteToFrequency(name);
    if (freq === null) {
      return;
    }
    var dur = (typeof duration === "number" && duration > 0) ? duration : 0.5;
    var ctx = ensureContext(false);
    if (!ctx) {
      return;
    }
    try {
      schedulePianoNote(ctx, freq, ctx.currentTime, dur);
    } catch (e) {
      // 音の再生に失敗しても画面は止めない
    }
  }

  // たいこの1つの層（発振器）を鳴らす
  function scheduleDrumTone(ctx, t, type, f0, f1, sweep, gain, decay, attack) {
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + sweep);
    if (attack > 0) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + attack);
    } else {
      g.gain.setValueAtTime(gain, t);
    }
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(t);
    osc.stop(t + decay + 0.02);
  }

  // 太鼓の音を鳴らす（胴の音・倍音・バチの音の3層）
  function playDrum() {
    if (!ONPU.music || !ONPU.music.DRUM || !ONPU.music.DRUM.body) {
      return;
    }
    var ctx = ensureContext(false);
    if (!ctx) {
      return;
    }
    try {
      var drum = ONPU.music.DRUM;
      var b = drum.body;
      var t = ctx.currentTime;

      // 胴の音
      scheduleDrumTone(ctx, t, b.type, b.f0, b.f1, b.sweep, b.gain, b.decay, b.attack);

      // 重ねる倍音
      if (drum.over) {
        scheduleDrumTone(
          ctx,
          t,
          drum.over.type,
          b.f0 * drum.over.ratio,
          b.f1 * drum.over.ratio,
          b.sweep,
          drum.over.gain,
          drum.over.decay,
          b.attack
        );
      }

      // バチが当たる音（白色雑音を帯域フィルタに通す）
      if (drum.hit && noiseBuffer) {
        var src = ctx.createBufferSource();
        var filter = ctx.createBiquadFilter();
        var hitGain = ctx.createGain();

        src.buffer = noiseBuffer;
        filter.type = "bandpass";
        filter.frequency.value = drum.hit.freq;
        filter.Q.value = drum.hit.q;

        hitGain.gain.setValueAtTime(drum.hit.gain, t);
        hitGain.gain.exponentialRampToValueAtTime(0.001, t + drum.hit.decay);

        src.connect(filter);
        filter.connect(hitGain);
        hitGain.connect(masterGain);

        src.start(t);
        src.stop(t + drum.hit.decay + 0.02);
      }
    } catch (e) {
      // 音の再生に失敗しても画面は止めない
    }
  }

  // メロディを予約して鳴らす
  function playMelody(key) {
    if (!ONPU.music || !ONPU.music.MELODIES || !ONPU.music.MELODIES[key]) {
      return;
    }
    var ctx = ensureContext(false);
    if (!ctx) {
      return;
    }
    try {
      var schedule = ONPU.music.toSchedule(ONPU.music.MELODIES[key]);
      var baseTime = ctx.currentTime + 0.05;
      for (var i = 0; i < schedule.events.length; i++) {
        var ev = schedule.events[i];
        schedulePianoNote(ctx, ev.frequency, baseTime + ev.start, ev.duration);
      }
    } catch (e) {
      // 音の再生に失敗しても画面は止めない
    }
  }

  // 複数の音を指定した時刻で予約して鳴らす
  function playSequence(list) {
    if (!Array.isArray(list) || !ONPU.music || typeof ONPU.music.noteToFrequency !== "function") {
      return;
    }
    var ctx = ensureContext(false);
    if (!ctx) {
      return;
    }
    try {
      var baseTime = ctx.currentTime + 0.05;
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        if (!item) {
          continue;
        }
        var freq = ONPU.music.noteToFrequency(item.name);
        if (freq !== null) {
          schedulePianoNote(ctx, freq, baseTime + item.start, item.duration);
        }
      }
    } catch (e) {
      // 音の再生に失敗しても画面は止めない
    }
  }

  ONPU.audio = {
    unlock: unlock,
    playNote: playNote,
    playDrum: playDrum,
    playMelody: playMelody,
    playSequence: playSequence
  };
})();

