import i18n from "./i18n";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly correlationId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = typeof body.code === "string" ? body.code : "REQUEST_REJECTED";
    const fallback =
      typeof body.message === "string"
        ? body.message
        : i18n.t("errors.REQUEST_REJECTED");
    const message = i18n.t(`errors.${code}`, { defaultValue: fallback });
    throw new ApiError(code, message, response.status, body.correlationId);
  }
  return body as T;
}
