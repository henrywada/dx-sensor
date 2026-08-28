import { Aperture, Bell, Contact, FileText, FolderOpen, ImagePlus, Images } from "lucide-react";
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
    label: "定点監視カメラ",
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
    label: "写真レポート",
    apps: [
      {
        icon: ImagePlus,
        title: "写真レポートの送信",
        description: "写真付きでレポートを作成・送信します。",
        href: "/send_picture",
      },
      {
        icon: Images,
        title: "写真フォルダーを見る",
        description: "写真レポートを表示・編集します。",
        href: "/send_picture_album",
      },
    ],
  },
  {
    label: "文書ホルダー",
    apps: [
      {
        icon: Contact,
        title: "名刺を撮る",
        description: "名刺を撮影し、AIで読み取った連絡先情報を確認して保存します。",
        href: "/documents/new?type=business_card",
      },
      {
        icon: FolderOpen,
        title: "名刺ホルダー",
        description: "保存した名刺を検索・編集し、必要なものを会社にも公開します。",
        href: "/documents?type=business_card",
      },
      {
        icon: FileText,
        title: "請求書を撮る",
        description: "請求書を撮影し、AIで読み取った内容を確認して保存します。",
        href: "/documents/new?type=invoice",
      },
      {
        icon: FolderOpen,
        title: "請求書ホルダー",
        description: "保存した請求書を検索・編集し、CSVでエクスポートします。",
        href: "/documents?type=invoice",
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
