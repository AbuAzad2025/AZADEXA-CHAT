import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ZestChat",
  description: "Chat that gets you. Anywhere. Any language.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" dir="ltr">
      <body>{children}</body>
    </html>
  );
}
