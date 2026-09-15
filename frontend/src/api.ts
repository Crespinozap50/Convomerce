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
async function throwApiError(response: Response): Promise<never> {
  const body = await response.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code : "REQUEST_REJECTED";
  const fallback =
    typeof body.message === "string"
      ? body.message
      : i18n.t("errors.REQUEST_REJECTED");
  const message = i18n.t(`errors.${code}`, { defaultValue: fallback });
  throw new ApiError(code, message, response.status, body.correlationId);
}
// A controller method that returns void/undefined sends a 200 with a
// genuinely empty body — response.json() on that throws "Unexpected end of
// JSON input" even though the request itself succeeded. Found live testing
// the Loggro connection panel. Read as text first and only parse when
// there's actually something to parse, instead of trusting every ok
// response to carry a JSON body the way the 204 case already didn't.
async function parseOkBody<T>(response: Response): Promise<T> {
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
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
  if (!response.ok) return throwApiError(response);
  return parseOkBody<T>(response);
}
// multipart upload — deliberately not `api()` with a JSON Content-Type
// override, since the browser must set the multipart boundary itself.
export async function apiUpload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!response.ok) return throwApiError(response);
  return parseOkBody<T>(response);
}
// triggers a browser download of a non-JSON (CSV) response body — `api()`
// always parses JSON, which a file download response isn't.
export async function apiDownload(path: string, filename: string): Promise<void> {
  const response = await fetch(`${API_URL}${path}`, { credentials: "include" });
  if (!response.ok) return throwApiError(response);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
