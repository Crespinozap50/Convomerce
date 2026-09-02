import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en";
import es from "./locales/es";

const stored = localStorage.getItem("commerce.uiLanguage");
const detected = navigator.language.toLowerCase().startsWith("es")
  ? "es"
  : "en";

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, es: { translation: es } },
  lng: stored === "es" || stored === "en" ? stored : detected,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

i18n.on("languageChanged", (language) =>
  localStorage.setItem("commerce.uiLanguage", language),
);
export default i18n;
