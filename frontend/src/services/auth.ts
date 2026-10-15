const API_BASE = "/api/auth";
const REQUEST_TIMEOUT_MS = 12000;

function currentLanguage(): "ar" | "en" {
  return localStorage.getItem("knowledge-ai-language") === "en" ? "en" : "ar";
}

export type User = {
  id: number;
  name: string;
  email: string;
  role?: string;
};

export type LoginResponse = {
  access_token: string;
  token_type: string;
};

export class SessionExpiredError extends Error {}

async function parseResponse(response: Response) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : currentLanguage() === "ar" ? "فشل الطلب." : "Request failed.",
    );
  }

  return data;
}

async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(`${API_BASE}${path}`, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(currentLanguage() === "ar"
        ? "انتهت مهلة الاتصال بالخادم. تأكد أن الخادم وقاعدة البيانات يعملان ثم حاول مرة أخرى."
        : "The server request timed out. Check that the backend and database are running, then try again.");
    }
    throw new Error(currentLanguage() === "ar"
      ? "تعذر الاتصال بالخادم. تأكد أن الخادم يعمل ثم حاول مرة أخرى."
      : "Unable to connect to the server. Check that the backend is running, then try again.");
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function register(
  name: string,
  email: string,
  password: string,
): Promise<User> {
  const response = await authFetch("/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, email, password }),
  });

  return parseResponse(response);
}

export async function login(
  email: string,
  password: string,
): Promise<LoginResponse> {
  const response = await authFetch("/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  return parseResponse(response);
}

export async function getCurrentUser(token: string): Promise<User> {
  const response = await authFetch("/me", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 401 || response.status === 403) {
    throw new SessionExpiredError("Session expired");
  }

  return parseResponse(response);
}
