import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pontreol",
  description: "Everything you need, right next door. Hire it, book it, ride it: nearby.",
};

const THEME_SCRIPT = `try{var t=localStorage.getItem("pontreol-theme");if(!t)t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";if(t==="light"){document.documentElement.classList.remove("dark");document.documentElement.classList.add("light")}}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* Apply the saved (or phone's) theme before paint to avoid a flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
