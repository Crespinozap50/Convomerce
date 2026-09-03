import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ShieldCheck } from "lucide-react";

export function AppSelect<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0 });
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      const node = event.target as Node;
      if (!root.current?.contains(node) && !menu.current?.contains(node))
        setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  useEffect(() => {
    if (!open || !root.current) return;
    const rect = root.current.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 260), window.innerWidth - 32);
    const left = Math.max(
      16,
      Math.min(rect.left, window.innerWidth - width - 16),
    );
    setPosition({ left, top: rect.bottom + 7, width });
    const close = () => setOpen(false);
    const closeOnExternalScroll = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", closeOnExternalScroll, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", closeOnExternalScroll, true);
    };
  }, [open]);
  const popup = open
    ? createPortal(
        <div
          className="app-select-menu"
          role="listbox"
          ref={menu}
          style={{
            left: position.left,
            top: position.top,
            width: position.width,
          }}
        >
          {options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={option.value === value ? "selected" : ""}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.value === value && <ShieldCheck size={16} />}
            </button>
          ))}
        </div>,
        document.body,
      )
    : null;
  return (
    <div className="app-select" ref={root}>
      <button
        type="button"
        className="app-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span>{selected?.label ?? value}</span>
        <ChevronDown size={17} className={open ? "rotated" : ""} />
      </button>
      {popup}
    </div>
  );
}
