export const formatLanguageName = (locale: string, displayLocale: string) => {
  try {
    const name =
      new Intl.DisplayNames([displayLocale], { type: "language" }).of(locale) ??
      locale;
    return name.charAt(0).toLocaleUpperCase(displayLocale) + name.slice(1);
  } catch {
    return locale;
  }
};
