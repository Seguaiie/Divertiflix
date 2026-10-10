namespace Divertiflix.Api.Auth;

public class JwtOptions
{
    public string Issuer { get; set; } = "divertiflix";
    public string Audience { get; set; } = "divertiflix-clients";
    /// <summary>Secret HMAC (>= 32 caractères). À surcharger par variable d'environnement hors dev.</summary>
    public string Key { get; set; } = "";
    public int AccessMinutes { get; set; } = 15;
    public int RefreshDays { get; set; } = 14;
    /// <summary>Durée absolue d'une session depuis la connexion : les rotations successives ne la prolongent pas.</summary>
    public int SessionDays { get; set; } = 60;
}
