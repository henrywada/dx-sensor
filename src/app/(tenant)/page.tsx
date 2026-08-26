import { Aperture, Bell, ImagePlus, Images } from "lucide-react";
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
    label: "スマホ監視カメラ",
    apps: [
      {
        icon: Aperture,
        title: "スマホのカメラで定点監視",
        description: "スマホのカメラ映像をAIで解析し、変化を監視します。",
        href: "/capture_auto",
      },
      {
        icon: Bell,
        title: "監視分析を見る",
        description: "保存された定点監視画像を比較し、変化の大きさとAI要約を確認します。",
        href: "/capture_auto_analyze",
      },
    ],
  },
  {
    label: "写真保存",
    apps: [
      {
        icon: ImagePlus,
        title: "スマホ写真にコメントを付けて保存",
        description: "件名と本文を付けて写真を撮影し、保存します。",
        href: "/send_picture",
      },
      {
        icon: Images,
        title: "アルバム表示",
        description: "保存した写真をグリッドで見返し、本文の編集や削除ができます。",
        href: "/send_picture_album",
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
