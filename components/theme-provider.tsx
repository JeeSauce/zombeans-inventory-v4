"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/** Dark forest-green is the brand default; users can switch to the cream light mode. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
