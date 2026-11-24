import fs from "node:fs";
import { readPackage } from "./package.mjs";

export * from "./package.mjs";

export function readPackageSummary(filePath) {
  return readPackage(fs.readFileSync(filePath));
}
