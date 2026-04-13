// ==========================================
// ルートレイアウト（Next.js App Router必須ファイル）
// ==========================================

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '競馬予想ツール',
  description: 'netkeibaデータを基にした競馬予想支援ツール',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
