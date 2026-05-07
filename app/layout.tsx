import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Footer, Header } from "@/components/site-chrome";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Last Bite — Order Swiggy on WhatsApp",
  description:
    "WhatsApp-native Swiggy ordering with a three-stage confirmation and a 30-second grace timer. Powered by Swiggy.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://swiggy-mcp.vercel.app"),
  openGraph: {
    title: "Last Bite — Order Swiggy on WhatsApp",
    description: "Three confirmation gates and a 30-second grace timer before any COD order goes through.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Header />
        <div className="flex flex-1 flex-col">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
