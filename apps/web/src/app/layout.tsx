import type { Metadata } from "next"
import localFont from "next/font/local"

import { ThemeProvider } from "@/components/theme/theme-provider"
import { AnchoredToastProvider, ToastProvider } from "@/components/ui/toast"
import { TooltipProvider } from "@/components/ui/tooltip"
import "./globals.css"

const geistSans = localFont({
  src: "./fonts/Geist-Latin.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
  style: "normal",
  display: "swap",
})

const dmSans = localFont({
  src: "./fonts/DMSans-500-Latin.woff2",
  variable: "--font-dm-sans",
  weight: "500",
  style: "normal",
  display: "swap",
})

const geistMono = localFont({
  src: "./fonts/GeistMono-Latin.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  style: "normal",
  display: "swap",
})

export const metadata: Metadata = {
  title: "Fillrate",
  description: "Private workbench for testing and comparing open-source PyVRP.",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${dmSans.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <ToastProvider>
            <AnchoredToastProvider>
              <TooltipProvider>{children}</TooltipProvider>
            </AnchoredToastProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
