import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Languages, ShieldCheck } from "lucide-react";
import { api } from "../api";

export function LanguageSwitcher({
  compact = false,
  persist = false,
}: {
  compact?: boolean;
  persist?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const current = i18n.language.startsWith("es") ? "es" : "en";
  const languages = [
    { code: "es", label: "Spanish (ES)" },
    { code: "en", label: "English (EN)" },
  ];
  const selected = languages.find((language) => language.code === current)!;
  return (
    <div className={compact ? "language-picker compact" : "language-picker"}>
      <button
        type="button"
        className="language-toggle"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("language.label")}
      >
        <Languages size={17} />
        <span>{selected.label}</span>
        <ChevronDown className={open ? "rotated" : ""} size={16} />
      </button>
      {open && (
        <div
          className="language-menu"
          role="listbox"
          aria-label={t("language.label")}
        >
          {languages.map((language) => (
            <button
              key={language.code}
              type="button"
              role="option"
              aria-selected={language.code === current}
              className={language.code === current ? "selected" : ""}
              onClick={() => {
                void i18n.changeLanguage(language.code);
                if (persist)
                  void api("/v1/auth/preferences", {
                    method: "PATCH",
                    body: JSON.stringify({ uiLanguage: language.code }),
                  });
                setOpen(false);
              }}
            >
              <span>{language.label}</span>
              {language.code === current && <ShieldCheck size={17} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
