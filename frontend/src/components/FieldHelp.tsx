import { Info } from "lucide-react";

export function FieldHelp({ children }: { children: string }) {
  return (
    <small className="field-help">
      <Info size={14} />
      <span>{children}</span>
    </small>
  );
}
