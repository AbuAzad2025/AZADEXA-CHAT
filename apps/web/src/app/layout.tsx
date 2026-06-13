import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ZestChat | Public rooms, real people",
  description:
    "Join welcoming public chat rooms by language and interest, then talk live.",
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
