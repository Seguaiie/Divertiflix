using Divertiflix.Domain;
using Microsoft.EntityFrameworkCore;

namespace Divertiflix.Infrastructure;

public class DivertiflixDbContext(DbContextOptions<DivertiflixDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Profile> Profiles => Set<Profile>();
    public DbSet<Title> Titles => Set<Title>();
    public DbSet<WatchlistItem> Watchlist => Set<WatchlistItem>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<User>(e =>
        {
            e.HasIndex(u => u.Email).IsUnique();
            e.Property(u => u.Email).HasMaxLength(256);
            e.Property(u => u.Role).HasConversion<string>();
            e.Property(u => u.Source).HasConversion<string>();
            e.HasMany(u => u.Profiles).WithOne().HasForeignKey(p => p.UserId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<Profile>(e =>
        {
            e.Property(p => p.Name).HasMaxLength(50);
            e.HasMany(p => p.Watchlist).WithOne().HasForeignKey(w => w.ProfileId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<Title>(e =>
        {
            e.Property(t => t.Name).HasMaxLength(200);
            e.Property(t => t.Kind).HasConversion<string>();
            e.HasIndex(t => t.Name);
            e.HasIndex(t => new { t.ExternalSource, t.ExternalId });
        });
        b.Entity<WatchlistItem>(e =>
        {
            e.HasKey(w => new { w.ProfileId, w.TitleId });
            e.HasOne(w => w.Title).WithMany().HasForeignKey(w => w.TitleId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<RefreshToken>().HasIndex(r => r.TokenHash);
    }
}
