import type { AdminUser, RequestStatus, Role, TicketCategory, TicketStatus, TitleKind } from './models';

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'muted';

export const KIND_LABEL: Record<TitleKind, string> = { Movie: 'Film', Series: 'Série', Audiobook: 'Livre audio' };

export const REQUEST_LABEL: Record<RequestStatus, string> = {
  Pending: 'En attente', Approved: 'Approuvée', Downloading: 'En téléchargement', Available: 'Disponible', Declined: 'Refusée',
};
export const REQUEST_TONE: Record<RequestStatus, Tone> = { Pending: 'warn', Approved: 'info', Downloading: 'info', Available: 'ok', Declined: 'bad' };

export const TICKET_LABEL: Record<TicketStatus, string> = { Open: 'Ouvert', InProgress: 'En cours', Resolved: 'Résolu' };
export const TICKET_TONE: Record<TicketStatus, Tone> = { Open: 'warn', InProgress: 'info', Resolved: 'ok' };
export const CATEGORY_LABEL: Record<TicketCategory, string> = { Playback: 'Lecture', Account: 'Compte', Content: 'Contenu', Other: 'Autre' };

export const ROLE_LABEL: Record<Role, string> = { Subscriber: 'Abonné', Support: 'Support', Admin: 'Administrateur' };
export const SOURCE_LABEL: Record<AdminUser['source'], string> = { Local: 'Local', ActiveDirectory: 'Active Directory' };

const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });

/** « il y a 3 h », « hier » : l'heure exacte reste disponible en infobulle. */
export function ago(date: string | Date, now = Date.now()): string {
  const diff = (new Date(date).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(0, 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(date).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const exact = (date: string | Date) => new Date(date).toLocaleString('fr-CA', { dateStyle: 'medium', timeStyle: 'short' });
