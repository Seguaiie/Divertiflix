import type { RequestStatus } from './models';

/**
 * Transitions permises pour une demande de contenu. Miroir de AdminController.Transitions côté API :
 * l'API reste l'autorité (elle répond 409 sinon), ce tableau ne sert qu'à n'offrir que des actions valides.
 */
export const NEXT_STATUS: Record<RequestStatus, readonly RequestStatus[]> = {
  Pending: ['Approved', 'Declined'],
  Approved: ['Downloading', 'Available', 'Declined'],
  Downloading: ['Available', 'Declined'],
  Available: [],
  Declined: [],
};

/** Verbe d'action affiché sur le bouton qui mène à un statut. */
export const ACTION_LABEL: Record<RequestStatus, string> = {
  Pending: 'Remettre en attente', Approved: 'Approuver', Downloading: 'Télécharger', Available: 'Rendre disponible', Declined: 'Refuser',
};

export const isFinal = (s: RequestStatus) => NEXT_STATUS[s].length === 0;
