import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Module 3 (quality/dispatch) was written against Next 14's lint config and
  // types API payloads as `any` throughout. Integration keeps it building and
  // flags those spots as warnings instead of errors; typing them properly is
  // a follow-up for the module owner. Don't add new files to this list.
  {
    files: [
      "src/app/(app)/quality/**",
      "src/app/(app)/dispatch/**",
      "src/app/api/rolls/**",
      "src/app/api/dispatches/**",
      "src/app/api/backup/**",
      "src/app/api/restore/**",
      "src/app/api/analytics/defects/**",
      "src/components/rolls/**",
      "src/components/quality/**",
      "src/lib/offline-queue.ts",
      "src/types/jsqr.d.ts",
    ],
    rules: { "@typescript-eslint/no-explicit-any": "warn" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-*/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
