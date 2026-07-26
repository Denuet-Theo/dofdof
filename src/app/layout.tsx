import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "Dofdof — Calculateur de Rentabilité Dofus",
  description:
    "Calculez la rentabilité de vos crafts, gérez vos prix et suivez vos ventes en HDV sur Dofus.",
  keywords: ["dofus", "craft", "rentabilité", "hdv", "kamas", "calculateur"],
};

const RootLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <html lang="fr" className={`dark ${inter.variable}`}>
      <body suppressHydrationWarning className="min-h-screen bg-dark-950 text-dark-100 antialiased font-sans">
        {children}
      </body>
    </html>
  );
};

export default RootLayout;
