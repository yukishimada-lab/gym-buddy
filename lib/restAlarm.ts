/**
 * 休憩タイマーの「あらかじめ音を仕込んだ音声」を組み立てる。
 *
 * 【なぜこれが要るのか】
 * iPhone の画面を消す(ロックする)と、ブラウザの JavaScript タイマーは止まる。
 * これまでの作りは「時間になったら Web Audio で鳴らす」だったので、
 * 画面が消えているあいだは時間が来ても鳴らせなかった。
 * (画面が消えないよう Wake Lock をかけていたのはこのため)
 *
 * 一方、いったん再生を始めた <audio> の音は、画面を消しても最後まで鳴り続ける
 * (音楽アプリと同じ扱いになる)。そこで発想を変えて、
 *
 *   「無音 → 残り3秒の予告音 → 終了音」を 1 本につないだ音声を作り、
 *    休憩開始と同時に再生する
 *
 * ことにした。時間の管理を音声そのものに任せるので、途中で JavaScript が
 * 止まっても関係なく、ロック中でも予定どおりの時刻に鳴る。
 *
 * ここには音の組み立て(何秒後にどの音を鳴らすか、WAV への書き出し)だけを置く。
 * 再生は lib/restSound.ts が受け持つ。
 */

/** 鳴らす音 1 つぶん */
export type AlarmTone = {
  /** 音声の先頭から何秒後に鳴らすか */
  startSec: number;
  /** 鳴らす長さ(秒) */
  durationSec: number;
  /** 高さ(Hz) */
  frequency: number;
  /** 音量(0〜1) */
  volume: number;
};

/** 終了音を繰り返す回数。1 回だと短くて気づけないため。 */
export const FINISH_REPEATS = 4;

/** 終了音の繰り返しの間隔(秒) */
const FINISH_INTERVAL_SEC = 1.2;

/** 予告音を鳴らす「残り秒数」 */
const COUNTDOWN_AT = [3, 2, 1];

/**
 * この長さを超える休憩では音声を作らない。
 *
 * 音声はデータとして全部メモリに載せるため、長すぎると重くなる
 * (8kHz・8bit で 1 秒あたり 8KB なので、10 分で約 4.8MB)。
 * 10 分を超える休憩はまれで、その場合は従来どおり画面が点いていれば鳴る。
 */
export const MAX_SCHEDULED_SECONDS = 600;

/** 音声の標準周波数。話し声より低いが、1kHz 前後の電子音には十分。 */
const SAMPLE_RATE = 8000;

/** 8bit PCM の無音(中央値) */
const SILENCE = 128;

/** 音の始まりと終わりを滑らかにする時間(秒)。ないと「プツッ」と鳴る。 */
const FADE_SEC = 0.005;

/**
 * 休憩の長さから「いつ・どんな音を鳴らすか」の一覧を作る。
 *
 * 予告音は残り 3・2・1 秒、終了音は 0 秒の時点から FINISH_REPEATS 回。
 */
export function alarmSchedule(restSeconds: number): AlarmTone[] {
  const tones: AlarmTone[] = [];

  for (const remaining of COUNTDOWN_AT) {
    const startSec = restSeconds - remaining;
    // 3 秒より短い休憩では、予告音が先頭より前になるので鳴らさない
    if (startSec > 0) {
      tones.push({ startSec, durationSec: 0.09, frequency: 660, volume: 0.5 });
    }
  }

  for (let i = 0; i < FINISH_REPEATS; i++) {
    const base = restSeconds + i * FINISH_INTERVAL_SEC;
    // ピッ ピッ ポーン(最後だけ高く長く)
    tones.push({ startSec: base, durationSec: 0.16, frequency: 880, volume: 0.9 });
    tones.push({ startSec: base + 0.22, durationSec: 0.16, frequency: 880, volume: 0.9 });
    tones.push({ startSec: base + 0.44, durationSec: 0.34, frequency: 1175, volume: 0.95 });
  }

  return tones;
}

/** 音声全体の長さ(秒)。最後の音が鳴り終わってから少し余韻を残す。 */
export function alarmTotalSeconds(restSeconds: number): number {
  const end = alarmSchedule(restSeconds).reduce(
    (max, tone) => Math.max(max, tone.startSec + tone.durationSec),
    0
  );
  return end + 0.3;
}

/** 44 バイトの WAV ヘッダ(8bit・モノラル)を書く */
function writeWavHeader(view: DataView, dataLength: number): void {
  const put = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };
  put(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true); // これ以降のバイト数
  put(8, "WAVE");
  put(12, "fmt ");
  view.setUint32(16, 16, true); // fmt チャンクの長さ
  view.setUint16(20, 1, true); // 1 = 非圧縮 PCM
  view.setUint16(22, 1, true); // モノラル
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE, true); // 1 秒あたりのバイト数(8bit モノラル)
  view.setUint16(32, 1, true); // 1 サンプルのバイト数
  view.setUint16(34, 8, true); // 8bit
  put(36, "data");
  view.setUint32(40, dataLength, true);
}

/**
 * 休憩の長さから WAV データを作る。
 * 先頭はほぼ無音で、予告音と終了音だけが入っている。
 */
export function renderAlarmWav(restSeconds: number): Uint8Array {
  const totalSec = alarmTotalSeconds(restSeconds);
  const sampleCount = Math.ceil(totalSec * SAMPLE_RATE);
  const buffer = new ArrayBuffer(44 + sampleCount);
  const view = new DataView(buffer);
  writeWavHeader(view, sampleCount);

  const samples = new Uint8Array(buffer, 44, sampleCount);
  samples.fill(SILENCE);

  for (const tone of alarmSchedule(restSeconds)) {
    const startIndex = Math.max(0, Math.round(tone.startSec * SAMPLE_RATE));
    const length = Math.round(tone.durationSec * SAMPLE_RATE);
    const fade = Math.max(1, Math.round(FADE_SEC * SAMPLE_RATE));

    for (let i = 0; i < length; i++) {
      const index = startIndex + i;
      if (index >= sampleCount) break;
      // 立ち上がり・立ち下がりの音量(0〜1)
      const envelope = Math.min(1, i / fade, (length - i) / fade);
      const value =
        Math.sin((2 * Math.PI * tone.frequency * i) / SAMPLE_RATE) *
        tone.volume *
        envelope;
      samples[index] = Math.max(0, Math.min(255, Math.round(SILENCE + value * 127)));
    }
  }

  return new Uint8Array(buffer);
}
