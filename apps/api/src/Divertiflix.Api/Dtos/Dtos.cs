using System.ComponentModel.DataAnnotations;
using Divertiflix.Domain;

namespace Divertiflix.Api.Dtos;

public record RegisterRequest([Required, EmailAddress] string Email, [Required, MinLength(8)] string Password, [Required, MaxLength(50)] string ProfileName);
public record LoginRequest([Required] string Email, [Required] string Password);
public record RefreshRequest([Required] string RefreshToken);
public record AuthResponse(string AccessToken, string RefreshToken, UserDto User);
public record UserDto(Guid Id, string Email, Role Role);

public record TitleDto(Guid Id, string Name, string Synopsis, int Year, TitleKind Kind, string Genre, int DurationMinutes, string? PosterUrl, string? StreamUrl);
public record TitleUpsert([Required, MaxLength(200)] string Name, string Synopsis, int Year, TitleKind Kind, string Genre, int DurationMinutes, string? PosterUrl, string? StreamUrl);
public record PagedResult<T>(IReadOnlyList<T> Items, int Total, int Page, int PageSize);

public record ProfileDto(Guid Id, string Name);
