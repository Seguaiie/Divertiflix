import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import type { Paged, Title, TitleUpsert } from './models';

@Injectable({ providedIn: 'root' })
export class TitlesService {
  private readonly http = inject(HttpClient);

  list(opts: { q?: string; genre?: string; page?: number; pageSize?: number } = {}): Observable<Paged<Title>> {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(opts)) if (v !== undefined && v !== '') params = params.set(k, String(v));
    return this.http.get<Paged<Title>>('/api/titles', { params });
  }
  create(t: TitleUpsert) { return this.http.post<Title>('/api/titles', t); }
  update(id: string, t: TitleUpsert) { return this.http.put<Title>(`/api/titles/${id}`, t); }
  remove(id: string) { return this.http.delete<void>(`/api/titles/${id}`); }
}
