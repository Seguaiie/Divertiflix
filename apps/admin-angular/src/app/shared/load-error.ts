import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';

/**
 * État d'erreur d'une liste. Un chargement raté ne doit jamais ressembler à une liste vide : « Aucun billet à traiter. Bon travail. »
 * alors que le serveur n'a pas répondu laisserait croire à l'agent qu'il n'y a rien à faire.
 */
@Component({
  selector: 'app-load-error',
  imports: [MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `.retry { margin-top: 16px; }`,
  template: `
    <div class="empty" role="alert">
      <strong>Chargement impossible</strong>{{ message() }}
      <div class="retry"><button matButton="outlined" type="button" (click)="again()">Réessayer</button></div>
    </div>
  `,
})
export class LoadError {
  readonly message = input.required<string>();
  readonly retry = output<void>();

  /** Le bouton disparaît dès que la relecture commence : le focus clavier passe sur la page au lieu de tomber sur <body>. */
  protected again(): void {
    document.getElementById('main')?.focus({ preventScroll: true });
    this.retry.emit();
  }
}
