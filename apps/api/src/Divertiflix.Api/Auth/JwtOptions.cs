namespace Divertiflix.Api.Auth;

public class JwtOptions
{
    public string Issuer { get; set; } = "divertiflix";
    public string Audience { get; set; } = "divertiflix-clients";
    /// <summary>Secret HMAC (>= 32 caractères). À surcharger par variable d'environnement hors dev.</summary>
    public string Key { get; set; } = "";
    public int AccessMinutes { get; set; } = 15;
    public int RefreshDays { get; set; } = 14;
}
