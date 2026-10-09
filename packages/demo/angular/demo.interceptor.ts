import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { delay, of, throwError } from 'rxjs';
import snapshot from '../data/snapshot.json';
import { createBackend } from '../src/backend';

// Faux serveur partagé avec le portail (même état dans le navigateur, évènements diffusés entre onglets).
const backend = createBackend(snapshot as never, { mediaBase: '../media/' });

/** Répond à tout appel /api/* sans réseau : mêmes routes, formes et règles que la vraie API. */
export const demoInterceptor: HttpInterceptorFn = (req) => {
  const url = new URL(req.urlWithParams, window.location.href);
  if (!url.pathname.startsWith('/api/')) return of(new HttpResponse({ status: 404 }));
  const res = backend.handle({
    method: req.method,
    path: url.pathname,
    query: url.searchParams,
    authorization: req.headers.get('Authorization'),
    body: req.body ?? undefined,
  });
  const jitter = 25 + Math.random() * 70;
  if (res.status >= 400) {
    return throwError(() => new HttpErrorResponse({ status: res.status, error: res.json, url: req.url })).pipe(delay(jitter));
  }
  return of(new HttpResponse({ status: res.status, body: res.json })).pipe(delay(jitter));
};
