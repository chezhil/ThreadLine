import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        status: {
          pass: "#16a34a",     // green-600
          running: "#16a34a",  // green-600
          rework: "#d97706",   // amber-600
          idle: "#d97706",     // amber-600
          reject: "#dc2626",   // red-600
          breakdown: "#dc2626",// red-600
          pending: "#6b7280",  // gray-500
        },
      },
      borderRadius: {
        DEFAULT: "0.5rem",
      },
    },
  },
  plugins: [],
};
export default config;
