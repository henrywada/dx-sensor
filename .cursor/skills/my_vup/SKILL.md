---
name: my_vup
description: >-
  Increments the semver display string (vX.Y.Z) in the right side of
  src/components/layout/SiteFooter.tsx. Use when the user invokes /my_vup,
  asks to bump the footer version, or to raise the displayed app version.
---

# my_vup（フッター右寄せバージョンの更新）

## 対象

- ファイル: `src/components/layout/SiteFooter.tsx`
- 変更箇所: フッター右寄せの `font-en` 付近にある `vX.Y.Z` 形式の文字列

## 手順

1. 現在の `vX.Y.Z` を読み取る。
2. セマンティックバージョンを **1 つだけ** 上げる。
   - **デフォルト（ユーザーが種類を指定しない場合）**: パッチ **Z** を +1（例: `v0.1.0` → `v0.1.1`）。
   - **マイナー** と明示された場合: **Y** を +1、**Z** を 0（例: `v0.1.0` → `v0.2.0`）。
   - **メジャー** と明示された場合: **X** を +1、**Y** と **Z** を 0（例: `v0.1.0` → `v1.0.0`）。
3. 表示文字列のみを更新する。`v` プレフィックスと `vX.Y.Z` フォーマットは維持する（`v.0.1.1` のように余分なドットは付けない）。
4. **保存後に必ず `SiteFooter.tsx` を再読み**し、実際に書き込まれた文字列を確認する。
5. ユーザーへの返答では **必ず** `旧 → 新` を明示する（例: `v0.1.0 → v0.1.1`）。会話の記憶や推測で番号を答えない。

## バージョン番号を聞かれたとき

- 表示は **常に** `src/components/layout/SiteFooter.tsx` の右寄せ `vX.Y.Z` のみが正（テナント画面・管理画面とも同じ `SiteFooter`）。
- **必ずそのファイルを Read してから**答える。直前の `/my_vup` の結果や会話履歴を使わない。
- ユーザーが「さっき上げたはず」と言った場合は、ファイルの現値を正とし、必要なら `git log -3 -- src/components/layout/SiteFooter.tsx` でその後の追加更新がないか確認して説明する。

## 実行してはいけないこと

- ユーザーが **`/my_vup` またはフッター版上げを明示していない**のに番号を上げない（作業完了のついでに上げない）。
- **1 回の `/my_vup` でパッチは 1 段だけ**。同じ依頼で複数回上げない。

## 注意

- `package.json` の `"version"` は別管理のため **自動では同期しない**。ユーザーが明示したときだけ合わせる。
- 同じバージョン文字列が他にあれば、フッターと整合するよう必要なら更新する（通常は SiteFooter のみ）。
- 別セッション・別エージェントでも `/my_vup` され得る。照会時は **常にファイルの現値**が唯一の正。
