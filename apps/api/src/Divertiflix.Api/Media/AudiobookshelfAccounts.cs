using System.Security.Cryptography;
using System.Text;
using Divertiflix.Api.Auth;
using Divertiflix.Domain;
using Divertiflix.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Divertiflix.Api.Media;

/// <summary>
/// Un utilisateur Audiobookshelf par compte Divertiflix, pour que la progression des livres soit enregistrée dans Audiobookshelf au nom de la
/// personne (et retrouvée dans son application). Créé à l'inscription ; pour un compte plus ancien (ou si Audiobookshelf était injoignable),
/// à la première écoute. Le compte de service (jeton de .env, administrateur) crée l'utilisateur et une clé d'API à son nom ; cette clé est
/// chiffrée en base avec une clé dérivée de Jwt:Key, et ne quitte jamais le serveur.
/// </summary>
public sealed class AudiobookshelfAccounts(DivertiflixDbContext db, AudiobookshelfClient abs, IOptions<JwtOptions> jwt, ILogger<AudiobookshelfAccounts> log)
{
    // Deux requêtes simultanées du même compte (deux onglets) ne doivent pas créer deux utilisateurs Audiobookshelf.
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private const string KeyName = "divertiflix";

    /// <summary>Clé d'API du compte lié, créé au besoin ; null si Audiobookshelf n'est pas configuré ou ne répond pas (l'appelant se rabat sur le compte de service).</summary>
    public async Task<string?> TokenAsync(Guid userId, CancellationToken ct)
    {
        if (!abs.Configured) return null;
        try
        {
            var link = await db.AudiobookshelfAccounts.AsNoTracking().FirstOrDefaultAsync(a => a.UserId == userId, ct);
            if (link is not null && Unprotect(link.ApiKeyProtected) is { } key) return key;
            await Gate.WaitAsync(ct);
            try { return await ProvisionAsync(userId, ct); }
            finally { Gate.Release(); }
        }
        catch (Exception ex) when (ex is HttpRequestException or InvalidOperationException or KeyNotFoundException or System.Text.Json.JsonException or DbUpdateException
                                   || (ex is TaskCanceledException && !ct.IsCancellationRequested))
        {
            log.LogWarning(ex, "Compte Audiobookshelf du compte {UserId} indisponible (nouvel essai à la prochaine écoute).", userId);
            return null;
        }
    }

    private async Task<string?> ProvisionAsync(Guid userId, CancellationToken ct)
    {
        var link = await db.AudiobookshelfAccounts.FirstOrDefaultAsync(a => a.UserId == userId, ct);
        if (link is not null && Unprotect(link.ApiKeyProtected) is { } existing) return existing;   // créé entre-temps par une autre requête

        if (link is not null)
        {
            // Lien présent mais clé illisible (Jwt:Key a changé) : nouvelle clé pour le même utilisateur Audiobookshelf, sa progression est conservée.
            var renewed = await abs.CreateApiKeyAsync(link.AbsUserId, KeyName, ct);
            link.ApiKeyProtected = Protect(renewed);
            await db.SaveChangesAsync(ct);
            return renewed;
        }

        var email = await db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => u.Email).FirstOrDefaultAsync(ct);
        if (email is null) return null;
        var taken = await abs.UsernamesAsync(ct);
        // Jamais de rattachement à un utilisateur existant du même nom (« root », un compte créé à la main) : on prend un nom libre.
        var username = new[] { email, $"{email}-{userId.ToString("N")[..6]}", $"divertiflix-{userId:N}" }.First(n => !taken.Contains(n));
        var absUserId = await abs.CreateUserAsync(username, Convert.ToHexString(RandomNumberGenerator.GetBytes(24)), ct);
        try
        {
            var key = await abs.CreateApiKeyAsync(absUserId, KeyName, ct);
            db.AudiobookshelfAccounts.Add(new AudiobookshelfAccount { UserId = userId, AbsUserId = absUserId, AbsUsername = username, ApiKeyProtected = Protect(key) });
            await db.SaveChangesAsync(ct);
            log.LogInformation("Utilisateur Audiobookshelf « {Username} » créé pour le compte {UserId}.", username, userId);
            return key;
        }
        catch
        {
            await abs.DeleteUserAsync(absUserId, CancellationToken.None);   // pas d'utilisateur orphelin dans Audiobookshelf
            throw;
        }
    }

    // ------------------------------------------------------------------ Chiffrement de la clé (AES-GCM, clé dérivée de Jwt:Key)

    private byte[] SecretKey() =>
        HKDF.DeriveKey(HashAlgorithmName.SHA256, Encoding.UTF8.GetBytes(jwt.Value.Key), 32, info: Encoding.UTF8.GetBytes("divertiflix:audiobookshelf-api-key"));

    private string Protect(string plain)
    {
        var nonce = RandomNumberGenerator.GetBytes(12);
        var data = Encoding.UTF8.GetBytes(plain);
        var cipher = new byte[data.Length];
        var tag = new byte[16];
        using (var aes = new AesGcm(SecretKey(), 16)) aes.Encrypt(nonce, data, cipher, tag);
        return Convert.ToBase64String([.. nonce, .. tag, .. cipher]);
    }

    private string? Unprotect(string stored)
    {
        try
        {
            var raw = Convert.FromBase64String(stored);
            if (raw.Length < 29) return null;
            var plain = new byte[raw.Length - 28];
            using var aes = new AesGcm(SecretKey(), 16);
            aes.Decrypt(raw.AsSpan(0, 12), raw.AsSpan(28), raw.AsSpan(12, 16), plain);
            return Encoding.UTF8.GetString(plain);
        }
        catch (Exception ex) when (ex is FormatException or CryptographicException) { return null; }
    }
}
