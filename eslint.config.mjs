import nextTs from "eslint-config-next/typescript";
export default [
  ...nextTs,
  { ignores: ["apps/**", "node_modules/**", "packages/contracts/src/generated.ts"] },
];
