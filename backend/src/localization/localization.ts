// esModuleInterop is off project-wide; a plain default import of these CJS/
// JSON modules doesn't bind correctly under ts-jest's commonjs output (see
// D-044 lint cleanup — this was verified to break at runtime, not assumed).
/* eslint-disable @typescript-eslint/no-require-imports */
import english = require('./locales/en.json');
import spanish = require('./locales/es.json');
/* eslint-enable @typescript-eslint/no-require-imports */

export type SupportedLanguage = 'en' | 'es';
export type ConversationLocale = string;
export type MessageIntentKey = keyof typeof english.intents;

export interface LocaleCatalog {
  meta: { locale: string; currencyLocale: string };
  bot: typeof english.bot;
  labels: typeof english.labels;
  intents: Record<MessageIntentKey, string[]>;
  stopWords: string[];
}

const catalogs: Record<SupportedLanguage, LocaleCatalog> = {
  en: english,
  es: spanish,
};

export function normalizeLocale(locale?: string | null): string {
  const candidate = locale?.trim().replace(/_/g, '-');
  if (!candidate) return 'en';
  try {
    return Intl.getCanonicalLocales(candidate)[0] ?? 'en';
  } catch {
    return 'en';
  }
}

export function languageFor(locale?: string | null): SupportedLanguage {
  const language = normalizeLocale(locale).split('-')[0];
  return language in catalogs ? language as SupportedLanguage : 'en';
}

export function catalogFor(locale?: string | null): LocaleCatalog {
  return catalogs[languageFor(locale)];
}

export function detectConversationLocale(
  message: string,
  configuredLocale: string,
): { locale: string; source: 'tenant_default' | 'detected' } {
  const detected = detectLanguageEvidence(message);
  if (!detected)
    return { locale: normalizeLocale(configuredLocale), source: 'tenant_default' };
  return languageFor(configuredLocale) === detected
    ? { locale: normalizeLocale(configuredLocale), source: 'tenant_default' }
    : { locale: detected, source: 'detected' };
}

export function detectLanguageEvidence(
  message: string,
): SupportedLanguage | null {
  const normalized = message
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const tokens = new Set(normalized.match(/[a-z0-9]+/g) ?? []);
  const score = (language: SupportedLanguage) => {
    const catalog = catalogs[language];
    const stopWords = catalog.stopWords.filter((word) => tokens.has(word)).length;
    const greetings = catalog.intents.greeting.filter((greeting) =>
      normalized.includes(greeting),
    ).length * 2;
    return stopWords + greetings;
  };
  const ranked = (Object.keys(catalogs) as SupportedLanguage[])
    .map((language) => ({ language, score: score(language) }))
    .sort((left, right) => right.score - left.score);
  if (!ranked[0] || ranked[0].score < 2) return null;
  if (ranked[1] && ranked[0].score - ranked[1].score < 2) return null;
  return ranked[0].language;
}

export function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? `{{${key}}}`));
}

export function stripLeadingGreeting(value: string, locale?: string | null): string {
  const greetings=catalogFor(locale).intents.greeting.sort((left,right)=>right.length-left.length);
  for(const greeting of greetings){
    const pattern=new RegExp(`^[¡!¿?\\s]*${greeting.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}[!,.?\\s]*`,'i');
    if(pattern.test(value))return value.replace(pattern,'').trim();
  }
  return value.trim();
}

export function isPlausibleName(value?: string | null): boolean {
  const trimmed = value?.trim() ?? '';
  return trimmed.length >= 2 && /\p{L}/u.test(trimmed);
}

export function formatMoney(valueMinor: string | number, currency: string, locale?: string | null): string {
  const normalized = normalizeLocale(locale);
  const formattingLocale=normalized.includes('-')?normalized:catalogFor(normalized).meta.currencyLocale;
  return new Intl.NumberFormat(formattingLocale, { style: 'currency', currency, maximumFractionDigits: 0 })
    .format(Number(valueMinor) / 100);
}

export function isValidLocale(locale: string): boolean {
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale)) return false;
  try {
    return Intl.getCanonicalLocales(locale).length === 1;
  } catch {
    return false;
  }
}
