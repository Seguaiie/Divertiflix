import type { Schemas } from '@divertiflix/api-client';

// Types partagés avec React, générés depuis l'OpenAPI de l'API.
export type Title = Schemas['TitleDto'];
export type TitleUpsert = Schemas['TitleUpsert'];
export type Paged<T> = { items: T[]; total: number; page: number; pageSize: number };
export type AuthResponse = Schemas['AuthResponse'];
export type User = AuthResponse['user'];
export type TitleKind = Schemas['TitleKind'];
