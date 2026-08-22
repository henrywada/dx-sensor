import { createServiceSupabase } from "@/lib/supabase/server";

/**
 * TEMPORARY DEBUG PAGE — confirms the app can reach Supabase and read data.
 * Uses the service-role client (bypasses RLS) because no login flow exists yet.
 * Delete this file (or replace it) once Auth + a real dashboard are in place.
 */
export default async function DebugHomePage() {
  const supabase = createServiceSupabase();

  const { data: tenants, error } = await supabase
    .from("tenants")
    .select("id, name, slug, is_premium, created_at")
    .order("created_at", { ascending: false });

  return (
    <main style={{ padding: "2rem" }}>
      <h1>dx-sensor: Supabase接続確認</h1>

      {error && (
        <div style={{ color: "red", marginTop: "1rem" }}>
          <strong>接続エラー:</strong> {error.message}
        </div>
      )}

      {!error && (
        <>
          <p>tenants テーブル: {tenants?.length ?? 0} 件</p>
          <table style={{ borderCollapse: "collapse", marginTop: "1rem" }}>
            <thead>
              <tr>
                <th style={cellStyle}>name</th>
                <th style={cellStyle}>slug</th>
                <th style={cellStyle}>is_premium</th>
                <th style={cellStyle}>created_at</th>
                <th style={cellStyle}>id</th>
              </tr>
            </thead>
            <tbody>
              {tenants?.map((t) => (
                <tr key={t.id}>
                  <td style={cellStyle}>{t.name}</td>
                  <td style={cellStyle}>{t.slug}</td>
                  <td style={cellStyle}>{String(t.is_premium)}</td>
                  <td style={cellStyle}>{t.created_at}</td>
                  <td style={cellStyle}>
                    <code>{t.id}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}

const cellStyle: React.CSSProperties = {
  border: "1px solid #ccc",
  padding: "0.5rem 1rem",
  textAlign: "left",
};
