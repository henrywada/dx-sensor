import { Aperture, Camera, ImagePlus, ScanLine, LineChart, Settings2, Sparkles } from "lucide-react";
import { AppCard, type AppCardProps } from "@/components/ui/AppCard";

interface Category {
  label: string;
  apps: AppCardProps[];
}

/**
 * Tenant-facing app catalog. Cards without an `href` render disabled with a
 * "準備中" badge. Wire up `href` as each app's page is built; add new
 * categories/cards here as new observation use cases go live (per the
 * "any observation target" concept — this list is meant to grow beyond parking).
 */
const categories: Category[] = [
  {
    label: "データを取り込む",
    apps: [
      {
        icon: ImagePlus,
        title: "スマホ画像の保存",
        description: "件名と本文を付けて写真を撮影し、保存します。",
        href: "/send_picture",
      },
      {
        icon: Aperture,
        title: "スマホのカメラで定点監視",
        description: "スマホのカメラ映像をAIで解析し、変化を監視します。",
        href: "/capture_auto",
      },
    ],
  },
  {
    label: "カメラ画像で分析",
    apps: [
      {
        icon: Sparkles,
        title: "画像解析",
        description: "保存済みの画像にAI解析を実行し、命令に応じた結果を確認します。",
        href: "/analyze",
      },
      {
        icon: Camera,
        title: "駐車場モニタリング",
        description: "定点カメラの画像から、駐車枠ごとの空き状況を自動で確認します。",
        badge: "準備中",
      },
      {
        icon: ScanLine,
        title: "ナンバープレート認識ログ",
        description: "検知した車両のナンバー・車種・色の履歴を一覧で確認します。",
        badge: "準備中",
      },
    ],
  },
  {
    label: "データを見る",
    apps: [
      {
        icon: LineChart,
        title: "観測履歴",
        description: "時系列で記録された観測データの推移をグラフで確認します。",
        badge: "準備中",
      },
    ],
  },
  {
    label: "設定",
    apps: [
      {
        icon: Settings2,
        title: "カメラ設置状況",
        description: "登録済みカメラの稼働状況や最終通信時刻を確認します。",
        badge: "準備中",
      },
    ],
  },
];

export default function TenantTopPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <p className="text-sm text-ink-soft">
        定点観測した画像をAIが解析し、変化を記録します。使いたい機能を選んでください。
      </p>

      <div className="mt-8 space-y-10">
        {categories.map((category) => (
          <section key={category.label}>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-soft">
              {category.label}
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {category.apps.map((app) => (
                <AppCard key={app.title} {...app} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
