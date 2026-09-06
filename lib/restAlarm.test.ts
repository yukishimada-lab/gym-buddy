import { describe, expect, it } from "vitest";
import {
  FINISH_REPEATS,
  alarmSchedule,
  alarmTotalSeconds,
  renderAlarmWav,
} from "./restAlarm";

/** 終了音(880Hz と 1175Hz)だけを取り出す */
function finishTones(restSeconds: number) {
  return alarmSchedule(restSeconds).filter((t) => t.frequency >= 880);
}

/** 予告音(660Hz)だけを取り出す */
function countdownTones(restSeconds: number) {
  return alarmSchedule(restSeconds).filter((t) => t.frequency === 660);
}

describe("alarmSchedule", () => {
  it("残り 3・2・1 秒に予告音を置く", () => {
    const starts = countdownTones(90).map((t) => t.startSec);
    expect(starts).toEqual([87, 88, 89]);
  });

  it("終了音は休憩が終わる時点から始まる", () => {
    expect(finishTones(90)[0].startSec).toBe(90);
  });

  it("終了音を 4 回繰り返す(1 回だと短くて気づけないため)", () => {
    // 1 回ぶんは「ピッ ピッ ポーン」の 3 音
    expect(finishTones(90)).toHaveLength(FINISH_REPEATS * 3);
    expect(FINISH_REPEATS).toBe(4);
  });

  it("繰り返しの間隔があいている(音が重ならない)", () => {
    const tones = finishTones(60);
    const repeatStarts = tones.filter((_, i) => i % 3 === 0).map((t) => t.startSec);
    for (let i = 1; i < repeatStarts.length; i++) {
      expect(repeatStarts[i] - repeatStarts[i - 1]).toBeGreaterThan(0.8);
    }
  });

  it("3 秒以下の休憩では、先頭より前になる予告音を鳴らさない", () => {
    expect(countdownTones(2).map((t) => t.startSec)).toEqual([1]);
    expect(countdownTones(1)).toHaveLength(0);
    // 終了音は必ず鳴る
    expect(finishTones(1).length).toBeGreaterThan(0);
  });

  it("休憩が長くなっても音の数は変わらない(無音が伸びるだけ)", () => {
    expect(alarmSchedule(30)).toHaveLength(alarmSchedule(600).length);
  });
});

describe("alarmTotalSeconds", () => {
  it("休憩の長さ + 終了音を鳴らしきる時間になる", () => {
    const total = alarmTotalSeconds(90);
    expect(total).toBeGreaterThan(90);
    // 4 回ぶん鳴らしても 10 秒はかからない
    expect(total).toBeLessThan(100);
  });
});

describe("renderAlarmWav", () => {
  const wav = renderAlarmWav(10);

  it("WAV として読める形式になっている", () => {
    const text = (offset: number, length: number) =>
      String.fromCharCode(...wav.slice(offset, offset + length));
    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 4)).toBe("WAVE");
    expect(text(12, 4)).toBe("fmt ");
    expect(text(36, 4)).toBe("data");
  });

  it("ヘッダに書いた長さと実際のデータ量が合っている", () => {
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const dataLength = view.getUint32(40, true);
    expect(dataLength).toBe(wav.byteLength - 44);
    expect(view.getUint32(4, true)).toBe(wav.byteLength - 8);
  });

  it("8kHz・8bit・モノラルで書き出す(サイズを抑えるため)", () => {
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getUint16(22, true)).toBe(1); // チャンネル数
    expect(view.getUint32(24, true)).toBe(8000); // サンプリング周波数
    expect(view.getUint16(34, true)).toBe(8); // ビット数
  });

  it("休憩中は無音で、終了時点に音が入っている", () => {
    const samples = wav.slice(44);
    const at = (sec: number) => samples[Math.round(sec * 8000)];
    // 休憩の途中(5 秒地点)は無音 = 128
    expect(at(5)).toBe(128);
    // 終了直後(10.05 秒地点)は音が入っている
    const finishChunk = samples.slice(
      Math.round(10 * 8000),
      Math.round(10.15 * 8000)
    );
    expect(finishChunk.some((v) => v !== 128)).toBe(true);
  });

  it("終了音がしっかり大きい(小さすぎて気づけない事故を防ぐ)", () => {
    const samples = wav.slice(44);
    const finishChunk = samples.slice(
      Math.round(10 * 8000),
      Math.round(10.16 * 8000)
    );
    const peak = Math.max(...finishChunk.map((v) => Math.abs(v - 128)));
    // 8bit の振幅は最大 127。その 8 割以上は出す
    expect(peak).toBeGreaterThan(100);
    // ただし振り切って歪まないこと(0〜255 に収まっていること)
    expect(Math.max(...finishChunk)).toBeLessThanOrEqual(255);
    expect(Math.min(...finishChunk)).toBeGreaterThanOrEqual(0);
  });

  it("1 秒あたり 8KB 程度に収まる(長い休憩でも重くなりすぎない)", () => {
    const perSecond = renderAlarmWav(60).byteLength / 60;
    expect(perSecond).toBeLessThan(9000);
  });
});
