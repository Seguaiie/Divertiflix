using System.ComponentModel.DataAnnotations;
using Divertiflix.Domain;

namespace Divertiflix.Api.Dtos;

// ------------------------------------------------------------------ Authentification

public record RegisterRequest([Required, EmailAddress, MaxLength(256)] string Email, [Required, MinLength(8), MaxLength(128)] string Password, [Required, MaxLength(50)] string ProfileName);
public record LoginRequest([Required, MaxLength(256)] string Email, [Required, MaxLength(128)] string Password);
public record RefreshRequest([Required, MaxLength(256)] string RefreshToken);
public record LogoutRequest([Required, MaxLength(256)] string RefreshToken);
public record AuthResponse(string AccessToken, string RefreshToken, UserDto User);
public record UserDto(Guid Id, string Email, Role Role);

// ------------------------------------------------------------------ Catalogue

/// <summary>Nature de la source de lecture : permet au client de choisir hls.js, la balise vidéo, la balise audio ou un lien.</summary>
public enum StreamKind { Hls, Video, Audio, External }

/// <summary>Vue publique d'un titre : jamais l'URL de lecture (délivrée, signée, par /playback).</summary>
public record TitleDto(
    Guid Id, string Name, string Synopsis, int Year, TitleKind Kind, string Genre, int DurationMinutes,
    string? PosterUrl, string? BackdropUrl, string? Author, string? Narrator, string? ExternalSource,
    IReadOnlyList<string> Keywords, IReadOnlyList<string> Cast, string? Director, double? Rating, string? Maturity,
    DateTime AddedAt, bool IsPlayable, StreamKind? StreamKind);

/// <summary>Vue d'administration : ajoute la source de lecture brute (réservé Admin/Support).</summary>
public record AdminTitleDto(
    Guid Id, string Name, string Synopsis, int Year, TitleKind Kind, string Genre, int DurationMinutes,
    string? PosterUrl, string? BackdropUrl, string? StreamUrl, string? Author, string? Narrator, string? ExternalSource,
    IReadOnlyList<string> Keywords, IReadOnlyList<string> Cast, string? Director, double? Rating, string? Maturity,
    DateTime AddedAt, bool IsPlayable, StreamKind? StreamKind);

public record TitleUpsert(
    [Required, MaxLength(200)] string Name,
    [MaxLength(4000)] string Synopsis,
    [Range(1888, 2200)] int Year,
    TitleKind Kind,
    [Required, MaxLength(60)] string Genre,
    [Range(0, 6000)] int DurationMinutes,
    [MaxLength(500)] string? PosterUrl,
    [MaxLength(1000)] string? StreamUrl,
    [MaxLength(200)] string? Author = null,
    [MaxLength(200)] string? Narrator = null,
    [MaxLength(500)] string? BackdropUrl = null,
    List<string>? Keywords = null,
    List<string>? Cast = null,
    [MaxLength(200)] string? Director = null,
    [Range(0, 10)] double? Rating = null,
    [MaxLength(10)] string? Maturity = null);

public record PagedResult<T>(IReadOnlyList<T> Items, int Total, int Page, int PageSize);
public record GenreCount(string Genre, int Count);

// ------------------------------------------------------------------ Profils, progression, notes

public record ProfileDto(Guid Id, string Name);
public record ProgressUpsert([Range(0, 86400)] int PositionSeconds, [Range(0, 86400)] int DurationSeconds);
public record RatingUpsert([Range(-1, 1)] int Value);

// ------------------------------------------------------------------ Accueil et recommandations

public record ProgressDto(int PositionSeconds, int DurationSeconds, double Fraction, DateTime UpdatedAt);
public record ReasonDto(string Type, Guid? TitleId, string? Title, string? Genre, IReadOnlyList<string>? Tags);

/// <summary>Un titre prêt à afficher : fiche, état du profil (reprise, liste, note) et raison de la recommandation.</summary>
public record CardDto(TitleDto Title, ProgressDto? Progress, bool InWatchlist, int MyRating, ReasonDto? Reason, int Match);

public record RequestCardDto(Guid Id, string Name, TitleKind Kind, int? Year, RequestStatus Status, DateTime UpdatedAt, bool Mine, Guid? TitleId);

/// <summary>Type : continue, watchlist, forYou, because, trending, recent, genre, audiobooks, requests.</summary>
public record RowDto(string Id, string Type, string? Seed, Guid? SeedTitleId, IReadOnlyList<CardDto> Items, IReadOnlyList<RequestCardDto>? Requests = null);
/// <summary>Mode : continue, recommended, featured.</summary>
public record HeroDto(CardDto Card, string Mode);
public record HomeDto(IReadOnlyList<HeroDto> Hero, IReadOnlyList<RowDto> Rows, DateTime GeneratedAt, bool HasTaste);

public record TitleDetailDto(CardDto Card, IReadOnlyList<CardDto> Similar, RequestCardDto? Request);
public record PlaybackDto(Guid TitleId, string Url, StreamKind Kind, int StartSeconds, DateTime ExpiresAt);

// ------------------------------------------------------------------ Assistant

public record ChatRequest([Required] Guid ProfileId, [Required, MaxLength(500)] string Message, [MaxLength(5)] string? Locale);
public record ChipDto(string Kind, string Label);
public record ChatStep(string Key, int? Count);
/// <summary>
/// Réponse structurée : le client rédige la phrase (FR/EN) à partir de Reply et de ses paramètres.
/// Reply : found, relaxed, nothing, similar, similarUnknown, surprise, help.
/// </summary>
public record ChatResponse(string Reply, string? Param, string? UnknownTitle, IReadOnlyList<ChipDto> Understood, IReadOnlyList<ChatStep> Steps, IReadOnlyList<CardDto> Cards);

// ------------------------------------------------------------------ Demandes, notifications, support

public record RequestCreate([Required, MaxLength(200)] string Name, TitleKind Kind, [Range(1888, 2200)] int? Year, [MaxLength(500)] string? Note, Guid? TitleId);
public record AdminRequestDto(Guid Id, string Name, TitleKind Kind, int? Year, string? Note, RequestStatus Status, Guid? TitleId, string RequestedBy, DateTime CreatedAt, DateTime UpdatedAt);
public record RequestStatusUpdate(RequestStatus Status, Guid? TitleId, [MaxLength(300)] string? Reason);

public record NotificationDto(Guid Id, string Kind, string Title, string? Body, string? Link, DateTime CreatedAt, bool Read);
public record NotificationsDto(IReadOnlyList<NotificationDto> Items, int Unread);
public record MarkReadRequest(List<Guid>? Ids);

public record TicketCreate([Required, MaxLength(120)] string Subject, TicketCategory Category, [Required, MaxLength(4000)] string Message);
public record TicketReply([Required, MaxLength(4000)] string Body);
public record TicketMessageDto(Guid Id, bool FromStaff, string Body, DateTime At);
public record TicketSummaryDto(Guid Id, string Subject, TicketCategory Category, TicketStatus Status, DateTime CreatedAt, DateTime UpdatedAt);
public record TicketDetailDto(TicketSummaryDto Ticket, IReadOnlyList<TicketMessageDto> Messages);
public record AdminTicketDto(TicketSummaryDto Ticket, string Requester, int Messages);
public record TicketStatusUpdate(TicketStatus Status);

// ------------------------------------------------------------------ Administration

public record AdminUserDto(Guid Id, string Email, Role Role, AccountSource Source, bool IsActive, DateTime CreatedAt, int Profiles);
public record AdminUserUpdate(Role? Role, bool? IsActive);
public record StatsDto(
    int Titles, int Playable, int Movies, int Series, int Audiobooks, IReadOnlyList<GenreCount> ByGenre,
    int Users, int ActiveUsers, int Staff,
    int RequestsPending, int RequestsInProgress, int TicketsOpen, int ActiveProfiles7d, int Plays24h);

public record ServiceStatus(string Id, string State, int? LatencyMs);
public record StatusDto(string Version, string State, IReadOnlyList<ServiceStatus> Services, DateTime At);

// ------------------------------------------------------------------ Synchronisations machine à machine

public record DirectoryAccountDto([Required, EmailAddress, MaxLength(256)] string Email, [Required, MaxLength(200)] string DisplayName, List<string> Groups);
public record DirectorySyncRequest([Required, MaxLength(5000)] List<DirectoryAccountDto> Accounts);
public record DirectorySyncResult(int Created, int Updated, int Deactivated, int Conflicts);

public record AudiobookItemDto(
    [Required, MaxLength(200)] string ExternalId,
    [Required, MaxLength(200)] string Name,
    [MaxLength(4000)] string? Synopsis,
    [MaxLength(200)] string? Author,
    [MaxLength(200)] string? Narrator,
    [Range(0, 100000)] int DurationMinutes,
    [MaxLength(500)] string? CoverUrl,
    [Required, MaxLength(1000)] string StreamUrl,
    [MaxLength(60)] string? Genre);
public record AudiobookshelfSyncRequest([Required, MaxLength(5000)] List<AudiobookItemDto> Items);
public record AudiobookshelfSyncResult(int Created, int Updated);
