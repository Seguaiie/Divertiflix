using Divertiflix.Api.Auth;
using Divertiflix.Api.Dtos;
using Divertiflix.Api.Support;
using Divertiflix.Domain;
using Divertiflix.Infrastructure;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace Divertiflix.Api.Controllers;

[ApiController, Route("api/auth"), EnableRateLimiting("auth")]
public class AuthController(DivertiflixDbContext db, TokenService tokens) : ControllerBase
{
    private static readonly PasswordHasher<User> Hasher = new();
    // Hash factice : un compte inexistant coûte autant de temps qu'un mauvais mot de passe (pas d'énumération par chronométrage).
    private static readonly string DummyHash = Hasher.HashPassword(new User(), "divertiflix-dummy-password");

    [HttpPost("register")]
    public async Task<ActionResult<AuthResponse>> Register(RegisterRequest req)
    {
        var email = req.Email.Trim().ToLowerInvariant();
        if (await db.Users.AnyAsync(u => u.Email == email)) return this.Err(409, "Courriel déjà utilisé.");
        var user = new User { Email = email };
        user.PasswordHash = Hasher.HashPassword(user, req.Password);
        user.Profiles.Add(new Profile { Name = req.ProfileName.Trim() });
        db.Users.Add(user);
        try { return await IssueAsync(user); }
        catch (DbUpdateException ex) when (ex.InnerException is Npgsql.PostgresException { SqlState: "23505" })
        { return this.Err(409, "Courriel déjà utilisé."); }
    }

    [HttpPost("login")]
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest req)
    {
        var email = req.Email.Trim().ToLowerInvariant();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email);
        var verdict = Hasher.VerifyHashedPassword(user ?? new User(), user?.PasswordHash ?? DummyHash, req.Password);
        if (user is null || !user.IsActive || verdict == PasswordVerificationResult.Failed)
            return this.Err(401, "Identifiants invalides.");
        return await IssueAsync(user);
    }

    [HttpPost("refresh")]
    public async Task<ActionResult<AuthResponse>> Refresh(RefreshRequest req)
    {
        var hash = TokenService.Hash(req.RefreshToken);
        var now = DateTime.UtcNow;
        // Rotation atomique : une seule requête concurrente peut consommer le jeton.
        var consumed = await db.RefreshTokens.Where(r => r.TokenHash == hash && r.RevokedAt == null && r.ExpiresAt > now)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.RevokedAt, now));
        if (consumed == 0) return this.Err(401, "Jeton de rafraîchissement invalide.");
        var userId = await db.RefreshTokens.Where(r => r.TokenHash == hash).Select(r => r.UserId).FirstAsync();
        var user = await db.Users.FindAsync(userId);
        return user is null || !user.IsActive ? this.Err(401, "Compte désactivé.") : await IssueAsync(user);
    }

    /// <summary>Révoque le jeton de rafraîchissement : « se déconnecter » coupe réellement la session côté serveur.</summary>
    [HttpPost("logout")]
    public async Task<IActionResult> Logout(LogoutRequest req)
    {
        var hash = TokenService.Hash(req.RefreshToken);
        var now = DateTime.UtcNow;
        await db.RefreshTokens.Where(r => r.TokenHash == hash && r.RevokedAt == null).ExecuteUpdateAsync(s => s.SetProperty(r => r.RevokedAt, now));
        return NoContent();
    }

    private async Task<ActionResult<AuthResponse>> IssueAsync(User user)
    {
        var (raw, entity) = tokens.CreateRefreshToken(user.Id);
        db.RefreshTokens.Add(entity);
        await db.SaveChangesAsync();
        return new AuthResponse(tokens.CreateAccessToken(user), raw, new UserDto(user.Id, user.Email, user.Role));
    }
}
