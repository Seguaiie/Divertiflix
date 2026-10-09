import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { problemMessage } from '../../core/problem';
import { HttpErrorResponse } from '@angular/common/http';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatProgressBarModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: grid; place-items: center; min-height: 100vh; padding: 16px; background: radial-gradient(900px 520px at 50% -8%, rgb(var(--accent-rgb) / 0.16), transparent 70%), radial-gradient(600px 400px at 85% 100%, rgb(228 64 164 / 0.08), transparent 70%), var(--bg-0); }
    .card { width: min(400px, 100%); background: var(--bg-1); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; box-shadow: 0 30px 80px -30px #000; }
    form { display: flex; flex-direction: column; gap: 6px; padding: 32px; }
    .logo { width: min(260px, 80%); height: auto; align-self: center; margin-bottom: 10px; filter: drop-shadow(0 18px 40px rgb(138 77 255 / 0.35)); }
    h1 { font-size: 1.5rem; font-weight: 700; line-height: 1.1; text-align: center; }
    .lead { margin: 4px 0 20px; color: var(--text-3); text-align: center; }
    button[type='submit'] { margin-top: 8px; height: 46px; }
  `,
  template: `
    <div class="card">
      @if (busy()) { <mat-progress-bar mode="indeterminate" aria-label="Connexion en cours" /> }
      <form [formGroup]="form" (ngSubmit)="submit()">
        <img class="logo" src="brand/logo.svg" alt="Divertiflix, stream without limits" width="260" height="172" />
        <h1>Back-office</h1>
        <p class="lead">Réservé au personnel autorisé.</p>
        <mat-form-field>
          <mat-label>Identifiant</mat-label>
          <input matInput formControlName="login" autocomplete="username" autocapitalize="none" spellcheck="false" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Mot de passe</mat-label>
          <input matInput type="password" formControlName="password" autocomplete="current-password" />
        </mat-form-field>
        @if (error()) { <p class="error-text" role="alert">{{ error() }}</p> }
        <button matButton="filled" type="submit" [disabled]="form.invalid || busy()">Se connecter</button>
      </form>
    </div>
  `,
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly form = inject(FormBuilder).nonNullable.group({
    login: ['', Validators.required],
    password: ['', Validators.required],
  });

  submit(): void {
    if (this.form.invalid || this.busy()) return;
    const { login, password } = this.form.getRawValue();
    this.busy.set(true);
    this.error.set(null);
    this.auth.login(login.trim(), password).subscribe({
      next: user => {
        this.busy.set(false);
        if (user.role === 'Subscriber') { this.auth.logout(); this.error.set("Ce compte n'a pas accès au back-office."); return; }
        void this.router.navigate(['/']);
      },
      error: (e: unknown) => {
        this.busy.set(false);
        this.error.set(e instanceof HttpErrorResponse && e.status === 401 ? 'Identifiants invalides.' : problemMessage(e, 'Connexion impossible.'));
      },
    });
  }
}
