namespace Divertiflix.Domain;

public enum Role { Subscriber, Support, Admin }

public enum TitleKind { Movie, Series, Audiobook }

/// <summary>D'où vient le compte : créé localement, ou synchronisé depuis l'Active Directory.</summary>
public enum AccountSource { Local, ActiveDirectory }

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
    public string? StreamUrl { get; set; }
    // Audiobook (Audiobookshelf) :
    public string? Author { get; set; }
    public string? Narrator { get; set; }
    /// <summary>Origine externe du contenu, ex. "Audiobookshelf" (null = catalogue local).</summary>
    public string? ExternalSource { get; set; }
    /// <summary>Identifiant côté système externe : clé d'upsert pour la synchronisation.</summary>
    public string? ExternalId { get; set; }
}

public class WatchlistItem
{
    public Guid ProfileId { get; set; }
    public Guid TitleId { get; set; }
    public Title? Title { get; set; }
    public DateTime AddedAt { get; set; } = DateTime.UtcNow;
}

public class RefreshToken
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public string TokenHash { get; set; } = "";
    public DateTime ExpiresAt { get; set; }
    public DateTime? RevokedAt { get; set; }
}
