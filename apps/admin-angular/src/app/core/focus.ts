import { afterNextRender, Injector } from '@angular/core';

/**
 * Après une décision qui retire la ligne de la liste (demande traitée, billet résolu), l'élément qui avait le focus n'existe plus
 * et le focus clavier tombe sur <body> : on le ramène sur le contenu de la page, comme après une navigation.
 * À appeler avant que la liste relue ne s'affiche ; sans effet si le focus est resté sur un élément.
 */
export function restoreLostFocus(injector: Injector): void {
  afterNextRender(() => {
    const active = document.activeElement;
    if (!active || active === document.body) document.getElementById('main')?.focus({ preventScroll: true });
  }, { injector });
}
