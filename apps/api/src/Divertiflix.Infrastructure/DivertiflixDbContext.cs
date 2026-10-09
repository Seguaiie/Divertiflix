using Divertiflix.Domain;
using Microsoft.EntityFrameworkCore;

namespace Divertiflix.Infrastructure;

public class DivertiflixDbContext(DbContextOptions<DivertiflixDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Profile> Profiles => Set<Profile>();
    public DbSet<Title> Titles => Set<Title>();
    public DbSet<WatchlistItem> Watchlist => Set<WatchlistItem>();
    public DbSet<PlaybackProgress> Progress => Set<PlaybackProgress>();
    public DbSet<Rating> Ratings => Set<Rating>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<MediaRequest> Requests => Set<MediaRequest>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<SupportTicket> Tickets => Set<SupportTicket>();
    public DbSet<TicketMessage> TicketMessages => Set<TicketMessage>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();

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
            e.Property(t => t.Genre).HasMaxLength(60);
            e.Property(t => t.Synopsis).HasMaxLength(4000);
            e.Property(t => t.Kind).HasConversion<string>();
            e.Property(t => t.Maturity).HasMaxLength(10);
            e.Property(t => t.ExternalId).HasMaxLength(200);
            e.Property(t => t.ExternalSource).HasMaxLength(60);
            e.Ignore(t => t.IsPlayable);
            e.HasIndex(t => t.Name);
            e.HasIndex(t => t.AddedAt);
            // Clé d'upsert des synchronisations : sans unicité, deux synchros simultanées créent des doublons.
            e.HasIndex(t => new { t.ExternalSource, t.ExternalId }).IsUnique().HasFilter("\"ExternalId\" IS NOT NULL");
        });
        b.Entity<WatchlistItem>(e =>
        {
            e.HasKey(w => new { w.ProfileId, w.TitleId });
            e.HasOne(w => w.Title).WithMany().HasForeignKey(w => w.TitleId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<PlaybackProgress>(e =>
        {
            e.HasKey(p => new { p.ProfileId, p.TitleId });
            e.Ignore(p => p.Fraction);
            e.HasOne(p => p.Title).WithMany().HasForeignKey(p => p.TitleId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Profile>().WithMany().HasForeignKey(p => p.ProfileId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(p => new { p.ProfileId, p.UpdatedAt });
            e.HasIndex(p => p.UpdatedAt);
        });
        b.Entity<Rating>(e =>
        {
            e.HasKey(r => new { r.ProfileId, r.TitleId });
            e.HasOne<Title>().WithMany().HasForeignKey(r => r.TitleId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Profile>().WithMany().HasForeignKey(r => r.ProfileId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<RefreshToken>(e =>
        {
            e.HasIndex(r => r.TokenHash);
            e.HasIndex(r => r.UserId);
            e.HasOne<User>().WithMany().HasForeignKey(r => r.UserId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<MediaRequest>(e =>
        {
            e.Property(r => r.Name).HasMaxLength(200);
            e.Property(r => r.Note).HasMaxLength(500);
            e.Property(r => r.Kind).HasConversion<string>();
            e.Property(r => r.Status).HasConversion<string>();
            e.HasOne(r => r.User).WithMany().HasForeignKey(r => r.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(r => r.Title).WithMany().HasForeignKey(r => r.TitleId).OnDelete(DeleteBehavior.SetNull);
            e.HasIndex(r => r.UpdatedAt);
            e.HasIndex(r => new { r.UserId, r.Status });
        });
        b.Entity<Notification>(e =>
        {
            e.Property(n => n.Kind).HasMaxLength(40);
            e.Property(n => n.Title).HasMaxLength(200);
            e.Property(n => n.Body).HasMaxLength(500);
            e.Property(n => n.Link).HasMaxLength(300);
            e.HasOne<User>().WithMany().HasForeignKey(n => n.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(n => new { n.UserId, n.CreatedAt });
        });
        b.Entity<SupportTicket>(e =>
        {
            e.Property(t => t.Subject).HasMaxLength(120);
            e.Property(t => t.Category).HasConversion<string>();
            e.Property(t => t.Status).HasConversion<string>();
            e.HasOne(t => t.User).WithMany().HasForeignKey(t => t.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(t => t.Messages).WithOne().HasForeignKey(m => m.TicketId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(t => new { t.UserId, t.UpdatedAt });
            e.HasIndex(t => t.Status);
        });
        b.Entity<TicketMessage>(e => e.Property(m => m.Body).HasMaxLength(4000));
        b.Entity<AuditLog>(e =>
        {
            e.Property(a => a.Action).HasMaxLength(60);
            e.Property(a => a.Target).HasMaxLength(200);
            e.Property(a => a.Detail).HasMaxLength(300);
            e.HasIndex(a => a.At);
        });
    }
}
