import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        purple: { 600: "#6C5CFF" },
        teal: { 500: "#00C9C7" },
        navy: { 900: "#0D1B2A", 800: "#1F2937" },
        paper: { light: "#F8FAFC", warm: "#FFF7E8" },
        accent: { coral: "#FF6B6B" },
        palestine: { red: "#C8102E", green: "#007A3D", black: "#111827" },
      },
      borderRadius: {
        organic: "28px 22px 30px 18px",
      },
      boxShadow: {
        painted: "0 16px 35px rgba(13,27,42,0.10), inset 0 0 0 1px rgba(255,255,255,0.5)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
