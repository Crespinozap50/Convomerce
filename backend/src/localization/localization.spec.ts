import { catalogFor, detectConversationLocale, formatMoney, isPlausibleName, isValidLocale, languageFor, normalizeLocale } from './localization';

describe('conversation localization', () => {
  it('canonicalizes BCP 47 locale tags', () => {
    expect(normalizeLocale('es_co')).toBe('es-CO');
    expect(normalizeLocale('invalid locale')).toBe('en');
  });

  it('uses English as the catalog fallback', () => {
    expect(languageFor('fr-FR')).toBe('en');
    expect(catalogFor('fr-FR').bot.defaultWelcome).toBe('Hello! How can I help you?');
  });

  it('keeps regional formatting while using a language catalog', () => {
    expect(formatMoney(5000, 'COP', 'es-CO')).toContain('$');
    expect(formatMoney(5000, 'COP', 'en-US')).toContain('COP');
  });

  it('validates supported BCP 47 shapes without restricting the language', () => {
    expect(isValidLocale('pt-BR')).toBe(true);
    expect(isValidLocale('not a locale')).toBe(false);
  });

  it('detects a clearly different language from the first customer message', () => {
    expect(
      detectConversationLocale('Hello, I would like to place an order', 'es'),
    ).toEqual({ locale: 'en', source: 'detected' });
    expect(
      detectConversationLocale('Hola, quiero hacer un pedido', 'en'),
    ).toEqual({ locale: 'es', source: 'detected' });
  });

  it('keeps the tenant locale when the message is linguistically ambiguous', () => {
    expect(detectConversationLocale('Calle 65 # 88-20', 'es-CO')).toEqual({
      locale: 'es-CO',
      source: 'tenant_default',
    });
  });

  it('rejects WhatsApp profile names too short or lacking letters to be a real name', () => {
    expect(isPlausibleName('S')).toBe(false);
    expect(isPlausibleName('')).toBe(false);
    expect(isPlausibleName('  ')).toBe(false);
    expect(isPlausibleName(null)).toBe(false);
    expect(isPlausibleName(undefined)).toBe(false);
    expect(isPlausibleName('12345')).toBe(false);
  });

  it('accepts a plausible real name', () => {
    expect(isPlausibleName('Carlos')).toBe(true);
    expect(isPlausibleName('María José')).toBe(true);
    expect(isPlausibleName('Al')).toBe(true);
  });
});
