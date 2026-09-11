import { describe, expect, it } from "vitest";
import { isMissingColumnError } from "./errors";

/**
 * 「列がまだ無い」エラーの判定。
 *
 * アプリは main へのプッシュで即座に本番に出るが、DB のマイグレーションは
 * 別のワークフローなので、片方だけ先に出ることがある。そのときに
 * 機能が丸ごと止まらないようにするための判定なので、取りこぼさないよう固定する。
 */
describe("isMissingColumnError", () => {
  it("PostgreSQL の undefined_column (42703)", () => {
    expect(
      isMissingColumnError({
        code: "42703",
        message: 'column "is_planned" of relation "workout_logs" does not exist',
      })
    ).toBe(true);
  });

  it("PostgREST のスキーマキャッシュに無い (PGRST204)", () => {
    expect(
      isMissingColumnError({
        code: "PGRST204",
        message: "Could not find the 'is_planned' column of 'workout_logs' in the schema cache",
      })
    ).toBe(true);
  });

  it("コードが無くてもメッセージから判定できる", () => {
    expect(
      isMissingColumnError({
        message: 'column "is_planned" does not exist',
      })
    ).toBe(true);
  });

  it("関係ないエラーは false(そのまま利用者に見せる)", () => {
    expect(isMissingColumnError({ code: "23505", message: "duplicate key value" })).toBe(false);
    expect(isMissingColumnError({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingColumnError({ message: "行が見つかりません" })).toBe(false);
  });

  it("エラーが無ければ false", () => {
    expect(isMissingColumnError(null)).toBe(false);
    expect(isMissingColumnError({})).toBe(false);
  });
});
