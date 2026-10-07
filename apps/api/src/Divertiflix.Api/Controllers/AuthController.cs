using Divertiflix.Api.Auth;
using Divertiflix.Api.Dtos;
using Divertiflix.Domain;
using Divertiflix.Infrastructure;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Divertiflix.Api.Controllers;

[ApiController, Route("api/auth")]
public class AuthController(DivertiflixDbContext db, TokenService tokens) : ControllerBase
{
    private readonly PasswordHasher<User> _hasher = new();

    [HttpPost("register")]
    public async Task<ActionResult<AuthResponse>> Register(RegisterRequest req)
    {
        var email = req.Email.Trim().ToLowerInvariant();
        if (await db.Users.AnyAsync(u => u.Email == email)) return Conflict(new { error = "Courriel déjà utilisé." });
        var user = new User { Email = email };
        user.PasswordHash = _hasher.HashPassword(user, req.Password);
        user.Profiles.Add(new Profile { Name = req.ProfileName });
        db.Users.Add(user);
        return await IssueAsync(user);
    }

    [HttpPost("login")]
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest req)
    {
        var email = req.Email.Trim().ToLowerInvariant();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email);
        if (user is null || _hasher.VerifyHashedPassword(user, user.PasswordHash, req.Password) == PasswordVerificationResult.Failed)
            return Unauthorized(new { error = "Identifiants invalides." });
        return await IssueAsync(user);
    }

    [HttpPost("refresh")]
    public async Task<ActionResult<AuthResponse>> Refresh(RefreshRequest req)
    {
        var hash = TokenService.Hash(req.RefreshToken);
        var stored = await db.RefreshTokens.FirstOrDefaultAsync(r => r.TokenHash == hash);
        if (stored is null || stored.RevokedAt is not null || stored.ExpiresAt < DateTime.UtcNow)
            return Unauthorized(new { error = "Jeton de rafraîchissement invalide." });
        stored.RevokedAt = DateTime.UtcNow; // rotation : un refresh token ne sert qu'une fois
        var user = await db.Users.FindAsync(stored.UserId);
        return user is null ? Unauthorized() : await IssueAsync(user);
    }

    private async Task<ActionResult<AuthResponse>> IssueAsync(User user)
    {
        var (raw, entity) = tokens.CreateRefreshToken(user.Id);
        db.RefreshTokens.Add(entity);
        await db.SaveChangesAsync();
        return new AuthResponse(tokens.CreateAccessToken(user), raw, new UserDto(user.Id, user.Email, user.Role));
    }
}
