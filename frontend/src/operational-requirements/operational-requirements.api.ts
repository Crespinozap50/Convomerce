import { api } from "../api";
import { OperationalRequirement, RequirementInput } from "./operational-requirements.types";

const base = (tenant: string) =>
  `/v1/admin/tenants/${tenant}/operational-requirements`;

export const listRequirements = (tenant: string) =>
  api<OperationalRequirement[]>(base(tenant));

export const createRequirement = (tenant: string, input: RequirementInput) =>
  api<OperationalRequirement>(base(tenant), {
    method: "POST",
    body: JSON.stringify(input),
  });

export const updateRequirement = (
  tenant: string,
  id: string,
  input: Partial<RequirementInput>,
) =>
  api<OperationalRequirement>(`${base(tenant)}/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });

export const setRequirementActive = (
  tenant: string,
  id: string,
  active: boolean,
) =>
  api<OperationalRequirement>(`${base(tenant)}/${id}/active`, {
    method: "PATCH",
    body: JSON.stringify({ active }),
  });

export const setRequirementLocalization = (
  tenant: string,
  id: string,
  locale: string,
  label: string,
  helpText: string | null,
) =>
  api<OperationalRequirement>(`${base(tenant)}/${id}/localizations/${locale}`, {
    method: "PUT",
    body: JSON.stringify({ label, helpText }),
  });

export const setRequirementOptions = (
  tenant: string,
  id: string,
  options: { value: string; displayOrder: number }[],
) =>
  api<OperationalRequirement>(`${base(tenant)}/${id}/options`, {
    method: "PUT",
    body: JSON.stringify({ options }),
  });

export const setRequirementOptionLocalization = (
  tenant: string,
  id: string,
  optionValue: string,
  locale: string,
  label: string,
) =>
  api<OperationalRequirement>(
    `${base(tenant)}/${id}/options/${encodeURIComponent(optionValue)}/localizations/${locale}`,
    { method: "PUT", body: JSON.stringify({ label }) },
  );
