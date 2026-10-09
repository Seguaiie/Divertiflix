using System.ComponentModel.DataAnnotations;
using Divertiflix.Domain;

namespace Divertiflix.Api.Dtos;

public record RegisterRequest([Required, EmailAddress] string Email, [Required, MinLength(8)] string Password, [Required, MaxLength(50)] string ProfileName);
public record LoginRequest([Required] string Email, [Required] string Password);
public record RefreshRequest([Required] string RefreshToken);
public record AuthResponse(string AccessToken, string RefreshToken, UserDto User);
public record UserDto(Guid Id, string Email, Role Role);

public record TitleDto(Guid Id, string Name, string Synopsis, int Year, TitleKind Kind, string Genre, int DurationMinutes, string? PosterUrl, string? StreamUrl, string? Author, string? Narrator, string? ExternalSource);
public record TitleUpsert([Required, MaxLength(200)] string Name, string Synopsis, int Year, TitleKind Kind, string Genre, int DurationMinutes, string? PosterUrl, string? StreamUrl, string? Author = null, string? Narrator = null);
public record PagedResult<T>(IReadOnlyList<T> Items, int Total, int Page, int PageSize);

public record ProfileDto(Guid Id, string Name);

// --- Synchronisation Active Directory (point 6 : préparation, livrée par un script Python) ---
public record DirectoryAccountDto([Required, EmailAddress] string Email, [Required] string DisplayName, List<string> Groups);
public record DirectorySyncRequest([Required] List<DirectoryAccountDto> Accounts);
public record DirectorySyncResult(int Created, int Updated, int Deactivated);

// --- Synchronisation Audiobookshelf (point 7 : préparation, livrée par un script Python) ---
public record AudiobookItemDto(
    [Required] string ExternalId,
    [Required, MaxLength(200)] string Name,
    string? Synopsis,
    string? Author,
    string? Narrator,
    int DurationMinutes,
    string? CoverUrl,
    [Required] string StreamUrl,
    string? Genre);
public record AudiobookshelfSyncRequest([Required] List<AudiobookItemDto> Items);
public record AudiobookshelfSyncResult(int Created, int Updated);
