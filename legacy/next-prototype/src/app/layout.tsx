import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CMaps - Worldbuilding Engine",
  description: "The ultimate vector-based GIS for worldbuilding.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
