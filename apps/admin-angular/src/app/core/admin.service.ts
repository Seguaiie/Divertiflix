import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type {
  AdminRequest, AdminTicket, AdminTitle, AdminUser, Paged, RequestStatus, Role, Stats, SystemStatus, TicketDetail, TicketStatus,
  TitleKind, TitleUpsert,
} from './models';

function query(opts: Record<string, string | number | undefined>): HttpParams {
  let params = new HttpParams();
  for (const [k, v] of Object.entries(opts)) if (v !== undefined && v !== '') params = params.set(k, String(v));
  return params;
}

/** Accès à la console d'exploitation (/api/admin/*). Le rôle est vérifié par l'API ; l'interface ne fait que masquer. */
@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly http = inject(HttpClient);

  stats(): Observable<Stats> { return this.http.get<Stats>('/api/admin/stats'); }
  status(): Observable<SystemStatus> { return this.http.get<SystemStatus>('/api/status'); }

  titles(o: { q?: string; kind?: TitleKind; page?: number; pageSize?: number } = {}): Observable<Paged<AdminTitle>> {
    return this.http.get<Paged<AdminTitle>>('/api/admin/titles', { params: query(o) });
  }
  createTitle(t: TitleUpsert) { return this.http.post<AdminTitle>('/api/admin/titles', t); }
  updateTitle(id: string, t: TitleUpsert) { return this.http.put<AdminTitle>(`/api/admin/titles/${id}`, t); }
  deleteTitle(id: string) { return this.http.delete<void>(`/api/admin/titles/${id}`); }

  users(o: { q?: string; page?: number; pageSize?: number } = {}): Observable<Paged<AdminUser>> {
    return this.http.get<Paged<AdminUser>>('/api/admin/users', { params: query(o) });
  }
  updateUser(id: string, patch: { role?: Role; isActive?: boolean }) { return this.http.put<AdminUser>(`/api/admin/users/${id}`, patch); }

  requests(status?: RequestStatus): Observable<AdminRequest[]> { return this.http.get<AdminRequest[]>('/api/admin/requests', { params: query({ status }) }); }
  updateRequest(id: string, body: { status: RequestStatus; titleId?: string | null; reason?: string | null }) {
    return this.http.put<AdminRequest>(`/api/admin/requests/${id}`, body);
  }

  tickets(status?: TicketStatus): Observable<AdminTicket[]> { return this.http.get<AdminTicket[]>('/api/admin/tickets', { params: query({ status }) }); }
  ticket(id: string): Observable<TicketDetail> { return this.http.get<TicketDetail>(`/api/support/tickets/${id}`); }
  reply(id: string, body: string) { return this.http.post(`/api/support/tickets/${id}/messages`, { body }); }
  setTicketStatus(id: string, status: TicketStatus) { return this.http.put(`/api/admin/tickets/${id}/status`, { status }); }
}
