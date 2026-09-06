import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * ユニットテストの設定。
 *
 * テストの対象は lib/ の計算ロジック(集計・分析・タイマーなど)に絞っている。
 * 画面の見た目のテストは手間の割に壊れやすいので入れていない。
 *
 *   npm test          … 1 回だけ実行する(CI と同じ)
 *   npm run test:watch … ファイルを保存するたびに実行する(開発中)
 */
export default defineConfig({
  test: {
    // アプリ側のコードは Node 上で動く純粋な関数だけを対象にする
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // アプリと同じ "@/..." の書き方をテストでも使えるようにする
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
