import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// Forbidden charting libraries inside report code. Per the Damban Reporting
// & Visualization Standard, every report must use Apache ECharts via
// `echarts-for-react`. Any other charting library is rejected at lint time
// so new reports cannot accidentally introduce a second engine.
const FORBIDDEN_CHART_LIBS = [
  { name: "recharts", message: "Use Apache ECharts (echarts-for-react) via @/components/reports/charts. Recharts is forbidden in reports." },
  { name: "chart.js", message: "Use Apache ECharts via @/components/reports/charts. chart.js is forbidden in reports." },
  { name: "react-chartjs-2", message: "Use Apache ECharts via @/components/reports/charts. react-chartjs-2 is forbidden in reports." },
  { name: "apexcharts", message: "Use Apache ECharts via @/components/reports/charts. apexcharts is forbidden in reports." },
  { name: "react-apexcharts", message: "Use Apache ECharts via @/components/reports/charts. react-apexcharts is forbidden in reports." },
];
const FORBIDDEN_CHART_PATTERNS = [
  { group: ["@nivo/*"], message: "Use Apache ECharts via @/components/reports/charts. @nivo/* is forbidden in reports." },
];

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  // ---------------------------------------------------------------------------
  // Visualization Standard enforcement — scoped to report code only so the
  // rest of the app (which doesn't render charts) is unaffected. The shadcn
  // `src/components/ui/chart.tsx` wrapper around Recharts is left alone; it
  // is not imported by any report.
  // ---------------------------------------------------------------------------
  {
    files: [
      "src/pages/reports/**/*.{ts,tsx}",
      "src/components/reports/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: FORBIDDEN_CHART_LIBS, patterns: FORBIDDEN_CHART_PATTERNS },
      ],
    },
  },
);
