export type OperationType = "order" | "appointment" | "service" | "quote";
export type RequirementDataType =
  | "text"
  | "number"
  | "select"
  | "boolean"
  | "address"
  | "phone";
export type Sensitivity = "none" | "pii" | "sensitive";

export type RequirementLocalization = {
  locale: string;
  label: string;
  helpText: string | null;
};

export type RequirementOption = {
  optionValue: string;
  displayOrder: number;
  localizations: { locale: string; label: string }[];
};

export type OperationalRequirement = {
  id: string;
  operationType: OperationType;
  fulfillmentType: string;
  catalogItemId: string | null;
  fieldKey: string;
  dataType: RequirementDataType;
  isRequired: boolean;
  displayOrder: number;
  validationRule: Record<string, unknown>;
  sensitivity: Sensitivity;
  retentionDays: number | null;
  requiresConfirmation: boolean;
  reuseFromContactMemory: boolean;
  isActive: boolean;
  localizations: RequirementLocalization[];
  options: RequirementOption[];
};

export type RequirementInput = {
  operationType: OperationType;
  fulfillmentType: string;
  catalogItemId: string | null;
  fieldKey: string;
  dataType: RequirementDataType;
  isRequired: boolean;
  displayOrder: number;
  validationRule: Record<string, unknown>;
  sensitivity: Sensitivity;
  retentionDays: number | null;
  requiresConfirmation: boolean;
};

export const operationTypes: OperationType[] = [
  "order",
  "appointment",
  "service",
  "quote",
];
export const requirementDataTypes: RequirementDataType[] = [
  "text",
  "number",
  "select",
  "boolean",
  "address",
  "phone",
];
export const sensitivities: Sensitivity[] = ["none", "pii", "sensitive"];
export const editableLocales = ["es", "en"] as const;
