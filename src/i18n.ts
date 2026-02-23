import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { en, ko, type Translations, type Lang, SUPPORTED_LANGS } from "./locales/index.js";
import { CONFIG_DIR, LANG_PATH } from "./types.js";

const LOCALES: Record<Lang, Translations> = { en, ko };
let _current: Translations = en;
let _currentLang: Lang = "en";

export function loadLang(): void {
  try {
    if (existsSync(LANG_PATH)) {
      const raw = readFileSync(LANG_PATH, "utf-8").trim() as Lang;
      if (SUPPORTED_LANGS.includes(raw)) {
        _currentLang = raw;
        _current = LOCALES[raw];
      }
    }
  } catch { /* en 유지 */ }
}

export function setLang(lang: string): { ok: boolean; message: string } {
  if (!SUPPORTED_LANGS.includes(lang as Lang)) {
    return {
      ok: false,
      message: `${_current.lang_unknown}: ${lang}. ${_current.lang_available}: ${SUPPORTED_LANGS.join(", ")}`,
    };
  }
  _currentLang = lang as Lang;
  _current = LOCALES[_currentLang];
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(LANG_PATH, lang, "utf-8");
  } catch {}
  return { ok: true, message: `${_current.lang_set_to} ${lang}` };
}

export function t(key: keyof Translations): string {
  return _current[key];
}

export function currentLang(): Lang {
  return _currentLang;
}
