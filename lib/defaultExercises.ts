/**
 * 初期登録用の代表的な種目。
 * supabase/schema.sql のトリガーでも同じ内容を新規ユーザーに自動登録するが、
 * 種目が 0 件のときにアプリ側からワンタップで登録できるフォールバックとしても使う。
 *
 * 部位の区分と表示順は lib/muscleGroups.ts に集約している。
 */
import { MUSCLE_GROUPS, type MuscleGroup } from "@/lib/muscleGroups";

export const DEFAULT_EXERCISES: { name: string; muscle_group: MuscleGroup }[] = [
  { name: "ベンチプレス", muscle_group: "胸" },
  { name: "ダンベルフライ", muscle_group: "胸" },
  { name: "インクラインベンチプレス", muscle_group: "胸" },
  { name: "デッドリフト", muscle_group: "背中" },
  { name: "ラットプルダウン", muscle_group: "背中" },
  { name: "ベントオーバーロー", muscle_group: "背中" },
  { name: "ショルダープレス", muscle_group: "肩" },
  { name: "サイドレイズ", muscle_group: "肩" },
  { name: "バーベルカール", muscle_group: "腕" },
  { name: "トライセプスエクステンション", muscle_group: "腕" },
  { name: "スクワット", muscle_group: "脚" },
  { name: "レッグプレス", muscle_group: "脚" },
  { name: "レッグカール", muscle_group: "脚" },
  { name: "アブローラー", muscle_group: "体幹" },
  { name: "プランク", muscle_group: "体幹" },
];

export { MUSCLE_GROUPS };
