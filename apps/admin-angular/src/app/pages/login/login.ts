import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatProgressBarModule],
  styles: `
    :host { display: grid; place-items: center; min-height: 100vh; }
    mat-card { width: min(380px, 92vw); }
    form { display: flex; flex-direction: column; gap: .5rem; padding: 1rem; }
    .error { color: var(--mat-sys-error); margin: 0; }
  `,
  template: `
    <mat-card>
      @if (busy()) { <mat-progress-bar mode="indeterminate" /> }
      <form [formGroup]="form" (ngSubmit)="submit()">
        <h1>Divertiflix — Back-office</h1>
        <mat-form-field>
          <mat-label>Identifiant</mat-label>
          <input matInput formControlName="login" autocomplete="username" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Mot de passe</mat-label>
          <input matInput type="password" formControlName="password" autocomplete="current-password" />
        </mat-form-field>
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        <button mat-flat-button type="submit" [disabled]="form.invalid || busy()">Se connecter</button>
      </form>
    </mat-card>
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
    const { login, password } = this.form.getRawValue();
    this.busy.set(true);
    this.error.set(null);
    this.auth.login(login, password).subscribe({
      next: user => {
        this.busy.set(false);
        if (user.role === 'Subscriber') { this.auth.logout(); this.error.set("Ce compte n'a pas accès au back-office."); return; }
        void this.router.navigate(['/']);
      },
      error: () => { this.busy.set(false); this.error.set('Identifiants invalides ou serveur injoignable.'); },
    });
  }
}
