export { en, type Translations } from "./en.js";
export { ko } from "./ko.js";
export const SUPPORTED_LANGS = ["en", "ko"] as const;
export type Lang = typeof SUPPORTED_LANGS[number];
