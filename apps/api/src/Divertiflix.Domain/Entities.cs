namespace Divertiflix.Domain;

public enum Role { Subscriber, Support, Admin }

public enum TitleKind { Movie, Series, Audiobook }

/// <summary>D'où vient le compte : créé localement, ou synchronisé depuis l'Active Directory.</summary>
public enum AccountSource { Local, ActiveDirectory }

/// <summary>Cycle de vie d'une demande de contenu (relayé plus tard vers Jellyseerr / Radarr / Sonarr).</summary>
public enum RequestStatus { Pending, Approved, Downloading, Available, Declined }

public enum TicketStatus { Open, InProgress, Resolved }

public enum TicketCategory { Playback, Account, Content, Other }

public class User
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public Role Role { get; set; } = Role.Subscriber;
    public AccountSource Source { get; set; } = AccountSource.Local;
    /// <summary>Compte désactivé (ex. retiré de l'Active Directory) : connexion refusée, données conservées.</summary>
    public bool IsActive { get; set; } = true;
    public DateTime? DirectorySyncedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<Profile> Profiles { get; set; } = [];
}

public class Profile
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public string Name { get; set; } = "";
    public List<WatchlistItem> Watchlist { get; set; } = [];
}

public class Title
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public string Synopsis { get; set; } = "";
    public int Year { get; set; }
    public TitleKind Kind { get; set; }
    public string Genre { get; set; } = "";
    public int DurationMinutes { get; set; }
    public string? PosterUrl { get; set; }
    public string? BackdropUrl { get; set; }
    /// <summary>
    /// Source de lecture. Trois formes : URL absolue (HLS, MP4, audio, ou page externe),
    /// ou "media:chemin" pour un fichier servi par l'API (/api/media/stream, URL signée à la lecture).
    /// Null = pas encore au catalogue (le titre peut être demandé).
    /// </summary>
    public string? StreamUrl { get; set; }
    // Audiobook (Audiobookshelf) :
    public string? Author { get; set; }
    public string? Narrator { get; set; }
    /// <summary>Origine externe du contenu, ex. "Audiobookshelf" ou "demo" (null = catalogue local).</summary>
    public string? ExternalSource { get; set; }
    /// <summary>Identifiant côté système externe : clé d'upsert pour la synchronisation.</summary>
    public string? ExternalId { get; set; }

    // Métadonnées d'exploitation par le moteur de recommandation.
    public List<string> Keywords { get; set; } = [];
    public List<string> Cast { get; set; } = [];
    public string? Director { get; set; }
    /// <summary>Note externe sur 10 (TMDB, MovieLens...), null si inconnue.</summary>
    public double? Rating { get; set; }
    /// <summary>Classification d'âge : "TP", "8+", "13+", "16+", "18+".</summary>
    public string? Maturity { get; set; }
    public DateTime AddedAt { get; set; } = DateTime.UtcNow;
    /// <summary>Attribution et licence (obligatoires pour les contenus CC BY : « © Blender Foundation, CC BY 3.0 »).</summary>
    public string? Credits { get; set; }
    /// <summary>Texte normalisé (minuscules, sans accents) pour la recherche ; recalculé par <see cref="RefreshSearchText"/>.</summary>
    public string SearchText { get; set; } = "";

    public bool IsPlayable => !string.IsNullOrWhiteSpace(StreamUrl);

    public void RefreshSearchText() =>
        SearchText = Text.Normalize(string.Join(' ', new[] { Name, Author, Narrator, Genre, Director }.Where(s => !string.IsNullOrWhiteSpace(s))
            .Concat(Keywords).Concat(Cast)));
}

public class WatchlistItem
{
    public Guid ProfileId { get; set; }
    public Guid TitleId { get; set; }
    public Title? Title { get; set; }
    public DateTime AddedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Reprise de lecture : une ligne par (profil, titre), mise à jour en continu par le lecteur.</summary>
public class PlaybackProgress
{
    public Guid ProfileId { get; set; }
    public Guid TitleId { get; set; }
    public Title? Title { get; set; }
    public int PositionSeconds { get; set; }
    public int DurationSeconds { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public double Fraction => DurationSeconds <= 0 ? 0 : Math.Clamp((double)PositionSeconds / DurationSeconds, 0, 1);
}

/// <summary>Pouce haut (+1) ou bas (-1) d'un profil sur un titre.</summary>
public class Rating
{
    public Guid ProfileId { get; set; }
    public Guid TitleId { get; set; }
    public short Value { get; set; }
    public DateTime At { get; set; } = DateTime.UtcNow;
}

public class RefreshToken
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public string TokenHash { get; set; } = "";
    public DateTime ExpiresAt { get; set; }
    public DateTime? RevokedAt { get; set; }
}

public class MediaRequest
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public User? User { get; set; }
    /// <summary>Titre déjà référencé au catalogue mais non lisible (demande d'ajout), ou titre créé à la satisfaction.</summary>
    public Guid? TitleId { get; set; }
    public Title? Title { get; set; }
    public string Name { get; set; } = "";
    public TitleKind Kind { get; set; } = TitleKind.Movie;
    public int? Year { get; set; }
    public string? Note { get; set; }
    public RequestStatus Status { get; set; } = RequestStatus.Pending;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class Notification
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    /// <summary>"request", "ticket", "title", "system" : sert à choisir l'icône côté client.</summary>
    public string Kind { get; set; } = "system";
    public string Title { get; set; } = "";
    public string? Body { get; set; }
    public string? Link { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ReadAt { get; set; }
}

public class SupportTicket
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public User? User { get; set; }
    public string Subject { get; set; } = "";
    public TicketCategory Category { get; set; } = TicketCategory.Other;
    public TicketStatus Status { get; set; } = TicketStatus.Open;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public List<TicketMessage> Messages { get; set; } = [];
}

public class TicketMessage
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TicketId { get; set; }
    public Guid AuthorId { get; set; }
    public bool FromStaff { get; set; }
    public string Body { get; set; } = "";
    public DateTime At { get; set; } = DateTime.UtcNow;
}

/// <summary>Journal d'audit des écritures sensibles (demandes, billets, administration).</summary>
public class AuditLog
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? UserId { get; set; }
    public string Action { get; set; } = "";
    public string Target { get; set; } = "";
    public string? Detail { get; set; }
    public DateTime At { get; set; } = DateTime.UtcNow;
}
