import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geist = Geist({ variable: "--font-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  return {
    metadataBase: base,
    title: { default: "Model Foreman — 从目标到交付，每一步都有证据", template: "%s · Model Foreman" },
    description: "Model Foreman 把规划、隔离执行、本地验证与人工批准串进同一条可恢复的工程工作流。",
    icons: { icon: "/foreman-line-cat-icon.png", apple: "/foreman-line-cat-icon.png" },
    openGraph: { title: "Model Foreman — 从目标到交付，每一步都有证据", description: "本地优先的多模型工程编排与安全交付工作台。", type: "website", images: [{ url: new URL("/og-yarn.png", base).toString(), width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title: "Model Foreman — 从目标到交付，每一步都有证据", description: "本地优先的多模型工程编排与安全交付工作台。", images: [new URL("/og-yarn.png", base).toString()] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body className={`${geist.variable} ${mono.variable}`}>{children}</body></html>;
}
