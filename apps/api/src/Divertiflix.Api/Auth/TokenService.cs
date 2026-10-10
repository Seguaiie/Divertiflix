using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Divertiflix.Domain;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Divertiflix.Api.Auth;

public class TokenService(IOptions<JwtOptions> options)
{
    private readonly JwtOptions _o = options.Value;

    public string CreateAccessToken(User user)
    {
        var creds = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_o.Key)), SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            _o.Issuer, _o.Audience,
            [
                new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
                new Claim(JwtRegisteredClaimNames.Email, user.Email),
                new Claim(ClaimTypes.Role, user.Role.ToString()),
            ],
            expires: DateTime.UtcNow.AddMinutes(_o.AccessMinutes),
            signingCredentials: creds);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    /// <summary>
    /// Retourne le jeton en clair (envoyé au client) et son empreinte (stockée en base). Une connexion ouvre une session (nouvelle
    /// famille, fin absolue dans <see cref="JwtOptions.SessionDays"/> jours) ; une rotation passe la famille et la fin de session du jeton remplacé.
    /// </summary>
    public (string Token, RefreshToken Entity) CreateRefreshToken(Guid userId, Guid? familyId = null, DateTime? sessionEnd = null)
    {
        var raw = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48));
        var now = DateTime.UtcNow;
        var end = sessionEnd ?? now.AddDays(_o.SessionDays);
        var expires = now.AddDays(_o.RefreshDays);
        return (raw, new RefreshToken
        {
            UserId = userId, FamilyId = familyId ?? Guid.NewGuid(), TokenHash = Hash(raw),
            ExpiresAt = expires < end ? expires : end, SessionExpiresAt = end,
        });
    }

    public static string Hash(string raw) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(raw)));
}
