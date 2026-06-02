import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.{test,spec}.{ts,tsx}"],
    // Glob patterns (not bare names): bare "node_modules" only matched a
    // top-level dir, so nested node_modules and agent worktrees under .claude/
    // leaked their own test files into our runs. Exclude them all.
    exclude: ["**/node_modules/**", ".next/**", "convex/_generated/**", ".claude/**"],
  },
});
