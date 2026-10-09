using System.Security.Cryptography;
using System.Text;
using Divertiflix.Api.Auth;
using Microsoft.Extensions.Options;

namespace Divertiflix.Api.Media;

/// <summary>
/// Jetons de lecture à durée courte pour les médias servis par l'API (/api/media/stream/{jeton}/...).
/// Le jeton est lié à l'utilisateur et au dossier du média, et vit dans le chemin pour que les
/// URL relatives d'une liste HLS (segments .ts) héritent de l'autorisation.
/// </summary>
public sealed class StreamSigner(IOptions<JwtOptions> options)
{
    private readonly byte[] _key = HMACSHA256.HashData(Encoding.UTF8.GetBytes(options.Value.Key), "divertiflix-stream-v1"u8.ToArray());

    public (string Token, DateTime ExpiresAt) Sign(Guid userId, string folder, TimeSpan ttl)
    {
        var exp = DateTime.UtcNow.Add(ttl);
        var unix = new DateTimeOffset(exp).ToUnixTimeSeconds();
        var uid = userId.ToString("N");
        return ($"{unix}.{uid}.{Mac(unix, uid, folder)}", exp);
    }

    public bool Verify(string token, string folder)
    {
        var parts = token.Split('.');
        if (parts.Length != 3 || !long.TryParse(parts[0], out var unix) || parts[1].Length != 32) return false;
        if (DateTimeOffset.FromUnixTimeSeconds(unix) < DateTimeOffset.UtcNow) return false;
        return CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Mac(unix, parts[1], folder)), Encoding.ASCII.GetBytes(parts[2]));
    }

    private string Mac(long unix, string uid, string folder) =>
        Convert.ToBase64String(HMACSHA256.HashData(_key, Encoding.UTF8.GetBytes($"{unix}|{uid}|{folder}")))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
