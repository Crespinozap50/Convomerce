import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Building2, ChevronDown, ShieldCheck } from "lucide-react";

export function TenantSelector({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.id === value);
  return (
    <div className="tenant-picker">
      <button
        className="tenant-trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Building2 size={20} />
        <span>{selected?.label ?? t("tenant.select")}</span>
        <ChevronDown className={open ? "rotated" : ""} size={17} />
      </button>
      {open && (
        <div
          className="tenant-menu"
          role="listbox"
          aria-label={t("tenant.selectorLabel")}
        >
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={option.id === value}
              className={option.id === value ? "selected" : ""}
              onClick={() => {
                onChange(option.id);
                setOpen(false);
              }}
            >
              <Building2 size={18} />
              <span>{option.label}</span>
              {option.id === value && <ShieldCheck size={17} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
