import createClient, { type Middleware } from "openapi-fetch";
import type { components, paths } from "./schema";

export type { components, paths };
export type Schemas = components["schemas"];

export interface AuthStore {
  getAccessToken(): string | null;
  /** Doit renvoyer un nouveau jeton d'accès, ou null si la session est expirée. */
  refresh(): Promise<string | null>;
}

/**
 * Client typé partagé par React et Angular : ajoute le jeton, et tente un refresh sur 401.
 *
 * Le corps d'une requête n'est lisible qu'une fois : fetch() le consomme, donc request.clone() après l'envoi lève
 * « Request body is already used » pour les POST et PUT. On garde donc une copie prise AVANT l'envoi, et c'est elle
 * qu'on rejoue avec le nouveau jeton.
 */
export function createApiClient(baseUrl: string, auth: AuthStore, fetchImpl: typeof fetch = (...a) => fetch(...a)) {
  // fetchImpl résolu à chaque appel (pas capturé à la création) : permet de mocker fetch dans les tests.
  const client = createClient<paths>({ baseUrl, fetch: fetchImpl });
  const replayable = new Map<string, Request>();

  const middleware: Middleware = {
    onRequest({ request, id }) {
      const token = auth.getAccessToken();
      if (token) request.headers.set("Authorization", `Bearer ${token}`);
      replayable.set(id, request.clone());
      return request;
    },
    async onResponse({ request, response, id }) {
      const copy = replayable.get(id);
      replayable.delete(id);
      const isAuthCall = new URL(request.url).pathname.startsWith("/api/auth/");
      if (response.status !== 401 || isAuthCall || !copy) return response;
      const token = await auth.refresh();
      if (!token) return response;
      copy.headers.set("Authorization", `Bearer ${token}`);
      return fetchImpl(copy);
    },
    onError({ id }) {
      replayable.delete(id);
    },
  };
  client.use(middleware);
  return client;
}
