import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // Treat a leading underscore as an explicit "intentionally unused"
      // marker for args, caught errors, and destructure-rest siblings —
      // the standard convention so deliberate throwaways don't need eslint-
      // disable comments. Genuinely dead vars/imports are still reported.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      // eslint-config-next pulls in react-hooks' (React 19) `set-state-in-effect`
      // rule, which flags the common fetch-on-mount pattern
      // `useEffect(() => { refreshAsync() }, [refreshAsync])` even when the
      // setState runs in a microtask AFTER an await (not a synchronous cascading
      // render). Keep it a visible warning instead of a hard CI failure; the
      // owning code can migrate to a data-fetching hook later.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
