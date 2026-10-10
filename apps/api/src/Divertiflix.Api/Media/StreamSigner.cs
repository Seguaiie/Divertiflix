using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Divertiflix.Api.Auth;
using Microsoft.Extensions.Options;

namespace Divertiflix.Api.Media;

/// <summary>
/// Jetons de lecture à durée courte pour les médias servis par l'API (/api/media/stream/{jeton}/...).
/// Le jeton est lié à l'utilisateur et au dossier du média, et vit dans le chemin pour que les
/// URL relatives d'une liste HLS (segments .ts) héritent de l'autorisation. Sa durée ne peut pas être courte (une lecture longue
/// et tous ses segments en dépendent) : l'état du compte est donc revérifié à chaque requête de flux (voir MediaEndpoints).
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

    /// <summary>Utilisateur du jeton s'il est authentique et non expiré, sinon null. Ne lève jamais : le jeton vient du client.</summary>
    public Guid? Verify(string token, string folder)
    {
        var parts = token.Split('.');
        if (parts.Length != 3 || !long.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out var unix) || !Guid.TryParseExact(parts[1], "N", out var userId)) return null;
        // Comparaison en secondes, sans conversion en date : un exp hors des bornes d'une date (99999999999999999) ne doit pas lever.
        if (unix < DateTimeOffset.UtcNow.ToUnixTimeSeconds()) return null;
        return CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Mac(unix, parts[1], folder)), Encoding.ASCII.GetBytes(parts[2])) ? userId : null;
    }

    private string Mac(long unix, string uid, string folder) =>
        Convert.ToBase64String(HMACSHA256.HashData(_key, Encoding.UTF8.GetBytes($"{unix}|{uid}|{folder}")))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
