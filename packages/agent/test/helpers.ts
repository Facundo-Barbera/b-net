import { readFileSync } from "node:fs";

export const fx = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
