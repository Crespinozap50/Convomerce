// esModuleInterop is off project-wide; a plain default import of these CJS/
// JSON modules doesn't bind correctly under ts-jest's commonjs output (see
// D-044 lint cleanup — this was verified to break at runtime, not assumed).
/* eslint-disable @typescript-eslint/no-require-imports */
import englishCommercial = require('./locales/en.commercial.json');
import spanishCommercial = require('./locales/es.commercial.json');
import englishAppointment = require('./locales/en.appointment.json');
import spanishAppointment = require('./locales/es.appointment.json');
import englishResponses = require('./locales/en.responses.json');
import spanishResponses = require('./locales/es.responses.json');
import englishRules = require('./locales/en.rules.json');
import spanishRules = require('./locales/es.rules.json');
/* eslint-enable @typescript-eslint/no-require-imports */
import { ConversationLocale, interpolate, languageFor } from './localization';

export type CommercialCopyKey = keyof typeof englishCommercial;
export type AppointmentCopyKey = keyof typeof englishAppointment;

const commercialCatalogs = { en: englishCommercial, es: spanishCommercial };
const appointmentCatalogs = { en: englishAppointment, es: spanishAppointment };
const responseCatalogs = { en: englishResponses, es: spanishResponses };
const ruleCatalogs = { en: englishRules, es: spanishRules };
export type ConversationRule = keyof typeof englishRules.patterns;

export function commercialCopy(
  locale: ConversationLocale,
  key: CommercialCopyKey,
  values: Record<string, string | number> = {},
): string {
  return interpolate(commercialCatalogs[languageFor(locale)][key], values);
}

export function matchesResponse(value: string, kind: 'affirmative' | 'negative'): boolean {
  const normalizeResponse=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
  const normalized=normalizeResponse(value);
  return Object.values(responseCatalogs).some(catalog=>catalog[kind].some(term=>{
    const candidate=normalizeResponse(term);
    return normalized===candidate||normalized.startsWith(`${candidate} `);
  }));
}

export function matchesConversationRule(value:string,rule:ConversationRule):boolean{
  return Object.values(ruleCatalogs).some(catalog=>catalog.patterns[rule].some(pattern=>new RegExp(pattern).test(value)));
}

export function mergedLanguageMap(section:'quantityWords'|'months'|'weekdays'):Record<string,number>{
  return Object.assign({},...Object.values(ruleCatalogs).map(catalog=>catalog[section]));
}

export function mergedLanguageTerms(section:'itemStopWords'):string[]{
  return [...new Set(Object.values(ruleCatalogs).flatMap(catalog=>catalog[section]))];
}

export function appointmentCopy(
  locale: ConversationLocale,
  key: AppointmentCopyKey,
  values: Record<string, string | number> = {},
): string {
  return interpolate(appointmentCatalogs[languageFor(locale)][key], values);
}
