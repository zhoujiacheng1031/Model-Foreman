import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import InteractiveYarnField from "./InteractiveYarnField";

const geist = Geist({ variable: "--font-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  return {
    metadataBase: base,
    title: { default: "Model Foreman — 把多个模型拧成一条交付线", template: "%s · Model Foreman" },
    description: "强模型定方向，执行模型写代码，独立门禁决定能否交付。Model Foreman 是本地优先的多模型工程编排应用。",
    icons: { icon: "/foreman-yarn-cluster-icon.png", apple: "/foreman-yarn-cluster-icon.png" },
    openGraph: { title: "Model Foreman — 多模型工程编排", description: "把多个模型拧成一条可恢复、可验证、可交付的工程工作流。", type: "website", images: [{ url: new URL("/og-yarn.png", base).toString(), width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title: "Model Foreman — 多模型工程编排", description: "把多个模型拧成一条可恢复、可验证、可交付的工程工作流。", images: [new URL("/og-yarn.png", base).toString()] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body className={`${geist.variable} ${mono.variable}`}><InteractiveYarnField />{children}</body></html>;
}
