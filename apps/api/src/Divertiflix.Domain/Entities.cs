namespace Divertiflix.Domain;

public enum Role { Subscriber, Support, Admin }

public enum TitleKind { Movie, Series }

public class User
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public Role Role { get; set; } = Role.Subscriber;
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
