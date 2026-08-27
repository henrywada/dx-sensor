#!/usr/bin/env bash
# ローカル Supabase 向け: 開発用ユーザー・テナント・developer 権限を作成する。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env.local ]]; then
  echo "error: .env.local が見つかりません" >&2
  exit 1
fi

# shellcheck disable=SC1091
source <(grep -E '^(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' .env.local | sed 's/^/export /')

API_URL="${NEXT_PUBLIC_SUPABASE_URL%/}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY}"

DEV_EMAIL="${DEV_EMAIL:-dev@localhost.local}"
DEV_PASSWORD="${DEV_PASSWORD:-devpassword}"
TENANT_NAME="${TENANT_NAME:-Local Dev}"
TENANT_SLUG="${TENANT_SLUG:-local-dev}"

if [[ "$API_URL" != http://127.0.0.1:* && "$API_URL" != http://localhost:* ]]; then
  echo "error: .env.local がローカル Supabase を指していません ($API_URL)" >&2
  exit 1
fi

echo "==> 開発ユーザーを作成または取得: $DEV_EMAIL"

USER_JSON=$(curl -sS -X POST "$API_URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$DEV_EMAIL\",\"password\":\"$DEV_PASSWORD\",\"email_confirm\":true}")

USER_ID=$(echo "$USER_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || true)

if [[ -z "$USER_ID" ]]; then
  USERS_JSON=$(curl -sS -G "$API_URL/auth/v1/admin/users" \
    -H "apikey: $SERVICE_KEY" \
    -H "Authorization: Bearer $SERVICE_KEY")
  USER_ID=$(echo "$USERS_JSON" | DEV_EMAIL="$DEV_EMAIL" python3 -c "
import json, os, sys
data = json.load(sys.stdin)
email = os.environ['DEV_EMAIL']
for u in data.get('users', []):
    if u.get('email') == email:
        print(u['id'])
        break
")
fi

if [[ -z "$USER_ID" ]]; then
  echo "error: ユーザー作成に失敗しました" >&2
  echo "$USER_JSON" >&2
  exit 1
fi

echo "    user_id: $USER_ID"
echo "==> テナント・developer メンバーシップを作成"

psql "postgresql://postgres:postgres@127.0.0.1:56422/postgres" -v ON_ERROR_STOP=1 <<SQL
insert into tenants (name, slug)
values ('$TENANT_NAME', '$TENANT_SLUG')
on conflict (slug) do update set name = excluded.name;

insert into tenant_members (tenant_id, user_id, role)
select t.id, '$USER_ID'::uuid, 'developer'
from tenants t
where t.slug = '$TENANT_SLUG'
on conflict (tenant_id, user_id) do update set role = excluded.role;
SQL

echo ""
echo "完了。ログイン情報:"
echo "  URL:      http://localhost:3000/login"
echo "  Email:    $DEV_EMAIL"
echo "  Password: $DEV_PASSWORD"
echo "  Studio:   http://127.0.0.1:56423"
