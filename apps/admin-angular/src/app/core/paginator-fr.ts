import { Injectable } from '@angular/core';
import { MatPaginatorIntl } from '@angular/material/paginator';

/** Libellés du paginateur Material en français (il les écrit en anglais par défaut, lecteurs d'écran compris). */
@Injectable()
export class PaginatorFr extends MatPaginatorIntl {
  override itemsPerPageLabel = 'Éléments par page';
  override nextPageLabel = 'Page suivante';
  override previousPageLabel = 'Page précédente';
  override firstPageLabel = 'Première page';
  override lastPageLabel = 'Dernière page';

  override getRangeLabel = (page: number, pageSize: number, length: number): string => {
    if (length === 0 || pageSize === 0) return '0 sur 0';
    const start = page * pageSize;
    const end = Math.min(start + pageSize, length);
    return `${start + 1} à ${end} sur ${length}`;
  };
}
