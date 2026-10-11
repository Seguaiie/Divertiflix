import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { Login } from './login';

function setup() {
  localStorage.clear();
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  const auth = TestBed.inject(AuthService);
  const fixture = TestBed.createComponent(Login);
  fixture.detectChanges();
  return { auth, fixture, ctl: TestBed.inject(HttpTestingController), el: fixture.nativeElement as HTMLElement };
}

describe('Login', () => {
  afterEach(() => localStorage.clear());

  it('n\'affiche aucun message quand l\'agent arrive de lui-même', () => {
    expect(setup().el.querySelector('[role="alert"]')).toBeNull();
  });

  it('explique pourquoi l\'agent a été renvoyé à la connexion (rôle retiré en cours de session)', () => {
    const { auth, fixture, el } = setup();
    auth.notice.set("Votre rôle a changé : ce compte n'a plus accès au back-office.");
    fixture.detectChanges();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain("n'a plus accès au back-office");
  });

  it('une nouvelle tentative efface l\'explication', () => {
    const { auth, fixture, ctl, el } = setup();
    auth.notice.set("Votre rôle a changé : ce compte n'a plus accès au back-office.");
    fixture.componentInstance.form.setValue({ login: 'agent', password: 'x' });
    fixture.componentInstance.submit();
    fixture.detectChanges();
    expect(el.querySelector('[role="alert"]')).toBeNull();
    ctl.expectOne('/api/auth/login');
  });
});
