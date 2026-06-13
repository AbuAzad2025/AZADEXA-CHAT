export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface RequestOptions {
  method?: "GET" | "POST";
  token?: string;
  body?: unknown;
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export const apiRequest = async <T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> => {
  const response = await fetch(`${API_URL}${path}`, {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.token
        ? { Authorization: `Bearer ${options.token}` }
        : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as
    | { success?: boolean; data?: T; error?: string }
    | null;

  if (!response.ok) {
    throw new ApiError(
      payload?.error || `Request failed with status ${response.status}`,
      response.status
    );
  }

  return payload?.data as T;
};
