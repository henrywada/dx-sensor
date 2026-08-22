import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "dx-sensor",
  description: "定点観測画像の時系列比較・AI解析プラットフォーム",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
