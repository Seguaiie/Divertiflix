import type { Schemas } from '@divertiflix/api-client';

// Types partagés avec React, générés depuis l'OpenAPI de l'API.
export type Title = Schemas['TitleDto'];
export type AdminTitle = Schemas['AdminTitleDto'];
export type TitleUpsert = Schemas['TitleUpsert'];
export type Paged<T> = { items: T[]; total: number; page: number; pageSize: number };
export type AuthResponse = Schemas['AuthResponse'];
export type User = AuthResponse['user'];
export type TitleKind = Schemas['TitleKind'];
export type Role = Schemas['Role'];
export type AdminUser = Schemas['AdminUserDto'];
export type AdminRequest = Schemas['AdminRequestDto'];
export type RequestStatus = Schemas['RequestStatus'];
export type AdminTicket = Schemas['AdminTicketDto'];
export type TicketDetail = Schemas['TicketDetailDto'];
export type TicketStatus = Schemas['TicketStatus'];
export type TicketCategory = Schemas['TicketCategory'];
export type Stats = Schemas['StatsDto'];
export type ServiceStatus = Schemas['ServiceStatus'];
export type SystemStatus = Schemas['StatusDto'];
