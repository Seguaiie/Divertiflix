namespace Divertiflix.Api.Media;

/// <summary>Connexion au serveur Audiobookshelf (section « Audiobookshelf » : Audiobookshelf__Url, Audiobookshelf__Token dans .env).</summary>
public sealed class AudiobookshelfOptions
{
    /// <summary>Adresse de base du serveur, ex. http://192.168.8.180:13378 (sans barre finale).</summary>
    public string Url { get; set; } = "";

    /// <summary>Jeton d'API d'un utilisateur Audiobookshelf. Reste côté serveur : jamais envoyé au navigateur.</summary>
    public string Token { get; set; } = "";

    /// <summary>Intervalle de synchronisation automatique du catalogue ; 0 la désactive (le bouton du back-office reste disponible).</summary>
    public int SyncMinutes { get; set; } = 60;

    public bool Configured =>
        Token.Length > 0 && Uri.TryCreate(Url, UriKind.Absolute, out var u) && (u.Scheme == Uri.UriSchemeHttp || u.Scheme == Uri.UriSchemeHttps);
}
