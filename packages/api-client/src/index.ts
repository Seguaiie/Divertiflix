import createClient, { type Middleware } from "openapi-fetch";
import type { components, paths } from "./schema";

export type { components, paths };
export type Schemas = components["schemas"];

export interface AuthStore {
  getAccessToken(): string | null;
  /** Doit renvoyer un nouveau jeton d'accès, ou null si la session est expirée. */
  refresh(): Promise<string | null>;
}

/** Client typé partagé par React et Angular : ajoute le jeton, et tente un refresh sur 401. */
export function createApiClient(baseUrl: string, auth: AuthStore, fetchImpl: typeof fetch = (...a) => fetch(...a)) {
  // fetchImpl résolu à chaque appel (pas capturé à la création) : permet de mocker fetch dans les tests.
  const client = createClient<paths>({ baseUrl, fetch: fetchImpl });

  const middleware: Middleware = {
    onRequest({ request }) {
      const token = auth.getAccessToken();
      if (token) request.headers.set("Authorization", `Bearer ${token}`);
      return request;
    },
    async onResponse({ request, response }) {
      const isAuthCall = new URL(request.url).pathname.startsWith("/api/auth/");
      if (response.status !== 401 || isAuthCall) return response;
      const token = await auth.refresh();
      if (!token) return response;
      const retry = request.clone();
      retry.headers.set("Authorization", `Bearer ${token}`);
      return fetchImpl(retry);
    },
  };
  client.use(middleware);
  return client;
}
