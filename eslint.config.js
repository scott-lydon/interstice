export default [
  {
    ignores: ["logs/**", "node_modules/**", ".git/**", "dist/**", "build/**"]
  },
  {
    files: ["lib/**", "bin/**", "web/**", "test/**"],
    rules: {
      semi: ["error", "always"]
    },
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        global: "readonly"
      }
    }
  }
];
