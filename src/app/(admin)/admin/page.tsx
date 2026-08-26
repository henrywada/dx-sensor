import { AdminDashboard } from "@/components/admin/AdminDashboard";
import {
  buildJstDateKeys,
  getDashboardStats,
  type DashboardStats,
} from "@/lib/admin/getDashboardStats";

function zeroStats(): DashboardStats {
  const zeros = buildJstDateKeys(30).map((date) => ({ date, count: 0 }));
  const yenZeros = buildJstDateKeys(30).map((date) => ({ date, yen: 0 }));
  return {
    users: [],
    userCount: 0,
    analysisCost: yenZeros,
    analysisCostTotalYen: 0,
    overall: zeros,
    monitorCamera: zeros,
    pictureSave: zeros,
  };
}

export default async function AdminPage() {
  let stats = zeroStats();
  let statsError: string | null = null;

  try {
    stats = await getDashboardStats();
  } catch (err) {
    console.error("getDashboardStats failed", err);
    statsError = err instanceof Error ? err.message : "不明なエラー";
  }

  return <AdminDashboard stats={stats} statsError={statsError} />;
}
