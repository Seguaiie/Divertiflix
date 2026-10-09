import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { bootstrapApplication } from '@angular/platform-browser';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding, withHashLocation } from '@angular/router';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { App } from '../../../apps/admin-angular/src/app/app';
import { routes } from '../../../apps/admin-angular/src/app/app.routes';
import { authInterceptor } from '../../../apps/admin-angular/src/app/core/auth.interceptor';
import { reset } from '../src/state';
import { demoInterceptor } from './demo.interceptor';

// Même configuration que l'application, avec un routage par hash (adresse d'hébergement inconnue) et le faux serveur en dernier maillon.
const config: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding(), withHashLocation()),
    provideHttpClient(withInterceptors([authInterceptor, demoInterceptor])),
    { provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { appearance: 'outline', subscriptSizing: 'dynamic' } },
  ],
};

bootstrapApplication(App, config).catch(err => console.error(err));

// Pastille « Démo » et aide de première visite (DOM direct : l'application n'est pas modifiée).
const bar = document.createElement('div');
bar.className = 'demo-bar';
bar.innerHTML = '<span class="demo-tag">Démo</span><a class="demo-link" target="_blank" rel="noopener" href="../index.html">Portail</a><button class="demo-link" type="button">Réinitialiser</button>';
bar.querySelector('button')!.addEventListener('click', () => { reset(); try { localStorage.removeItem('divertiflix.admin.session'); } catch { /* rien */ } location.reload(); });
document.body.append(bar);

let seen = false;
try { seen = sessionStorage.getItem('divertiflix.demo.hint.admin') === '1'; } catch { /* stockage indisponible */ }
if (!seen) {
  const hint = document.createElement('div');
  hint.className = 'demo-hint';
  hint.setAttribute('role', 'note');
  hint.innerHTML = '<p></p><button type="button" aria-label="Fermer">OK</button>';
  hint.querySelector('p')!.textContent = "Démonstration sans serveur. Connectez-vous avec n'importe quel mot de passe : root est administrateur, support est en lecture et réponse aux billets. Ouvrez le portail dans un autre onglet : ce que vous décidez ici y arrive en direct.";
  const onAway = (e: Event) => { if (!hint.contains(e.target as Node)) close(); };
  const close = () => { hint.remove(); document.removeEventListener('pointerdown', onAway); try { sessionStorage.setItem('divertiflix.demo.hint.admin', '1'); } catch { /* rien */ } };
  hint.querySelector('button')!.addEventListener('click', close);
  document.body.append(hint);
  setTimeout(() => document.addEventListener('pointerdown', onAway), 1500);
  setTimeout(close, 14000);
}
