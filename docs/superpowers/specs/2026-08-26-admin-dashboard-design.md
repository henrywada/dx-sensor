# Admin Dashboard Redesign

**Date:** 2026-08-26  
**Status:** Approved for implementation (chat design OK)  
**Route:** `/admin`（`src/app/(admin)/admin`）

## Summary

Replace the dashboard card grid with user stats and daily usage charts. Keep existing AppCard menus on other sidebar sections (including 「準備中」 cards).

## Decisions (from brainstorming)

| Topic | Choice |
|-------|--------|
| Metrics source | Existing tables (no new access-log table) |
| Login column | `last_sign_in_at` as 「最終ログイン」（件数ではない） |
| Chart range | Last 30 days, daily buckets |
| 準備中 cards | Keep on non-dashboard sidebar panels |
| Charts | SVG + cubic bezier (no chart library) |
| スマホ監視カメラ series | Count all `manual_captures` rows (includes admin `/admin/capture` until a `source` column exists) |
| 写真保存 series | Count `picture_sends` |
| Overall series | Sum of the two daily series |

## Screen behavior

`AdminDashboard` keeps the left sidebar. The right pane depends on `selectedKey`:

| Sidebar | Right pane |
|---------|------------|
| ダッシュボード | Stats UI only (no AppCard grid) |
| テナント管理 / カメラ・センサー / データ確認 / システム設定 | Existing AppCard grid (unchanged, including 準備中) |

Dashboard copy:

- Title: ダッシュボード
- Description: ユーザーとサービスの利用状況を確認します。

### Dashboard layout (top → bottom)

1. **ユーザ情報**
   - User count
   - Table: メール / 作成日 / 最終ログイン（`ja-JP`, missing login → `—`）
   - Sort: `created_at` desc
   - No pagination in v1

2. **アクセス状況**
   - Overall chart (one curved line)
   - Service charts: two separate panels — 「スマホ監視カメラ」「写真保存」
   - Hover tooltip: date + count

## Data access

All aggregation runs on the server with `createServiceSupabase()` (developer-only page already gated by `(admin)/layout`).

### Users

- `supabase.auth.admin.listUsers()` (paginate if API returns pages)
- Fields: `email`, `created_at`, `last_sign_in_at`

### Daily series (JST calendar days)

For each of the last 30 JST dates `D`:

- `manual_captures` where `created_at` falls on `D` → count
- `picture_sends` where `created_at` falls on `D` → count
- overall = sum

Days with zero activity still appear on the X axis.

Implementation note: fetch rows with `created_at >= startOfRange` (or count via SQL if convenient), bucket in TypeScript using Asia/Tokyo date keys `YYYY-MM-DD`.

## File plan

| File | Role |
|------|------|
| `src/lib/admin/getDashboardStats.ts` | Fetch users + build 30-day series |
| `src/components/admin/AdminDashboard.tsx` | Sidebar; dashboard stats vs card grid |
| `src/components/admin/DashboardStats.tsx` | User table + chart sections (client for hover) |
| `src/components/admin/CurvedLineChart.tsx` | Reusable SVG curved line chart |
| `src/app/(admin)/admin/page.tsx` | Await stats, pass props into `AdminDashboard` |

No new DB migration in this scope.

## Out of scope

- Access-event logging table
- Separating `capture_auto` vs `/admin/capture` in charts
- Chart library (recharts etc.)
- User list pagination
- Email notifications / background monitoring (separate initiative)

## Testing

- `/admin` as developer: dashboard shows count, table, three chart areas
- Switch sidebar to データ確認: cards (接続確認 / 手動撮影 / 画像解析 / …) still appear
- Empty DB: charts render flat zeros; user table empty or current users only
- Non-developer still redirected by existing admin layout
