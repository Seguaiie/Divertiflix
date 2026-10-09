using Divertiflix.Api.Media;
using Divertiflix.Domain;
using Divertiflix.Infrastructure;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Divertiflix.Api.Data;

public static class Seeder
{
    public static async Task SeedAsync(IServiceProvider sp, IConfiguration config)
    {
        var db = sp.GetRequiredService<DivertiflixDbContext>();
        await db.Database.MigrateAsync();

        await SeedAdminAsync(db, sp, config);

        // Titres antérieurs à la recherche normalisée : on remplit SearchText une fois.
        var unindexed = await db.Titles.Where(t => t.SearchText == "").ToListAsync();
        foreach (var t in unindexed) t.RefreshSearchText();

        if (config.GetValue("Seed:DemoCatalog", true)) await SeedDemoCatalogAsync(db, config);
        await db.SaveChangesAsync();
    }

    private static async Task SeedAdminAsync(DivertiflixDbContext db, IServiceProvider sp, IConfiguration config)
    {
        // Compte admin par défaut (dev). En dehors de Development, Seed:AdminPassword est obligatoire.
        var login = (config["Seed:AdminLogin"] ?? "root").Trim().ToLowerInvariant();
        var password = config["Seed:AdminPassword"];
        if (password is null)
        {
            if (!sp.GetRequiredService<IHostEnvironment>().IsDevelopment())
                throw new InvalidOperationException("Seed:AdminPassword doit être défini hors développement (variable Seed__AdminPassword).");
            password = "boom123$";
        }

        // Ancien compte de seed (admin@divertiflix.local) : renommé pour garder les données existantes.
        var admin = await db.Users.FirstOrDefaultAsync(u => u.Email == login)
                    ?? await db.Users.FirstOrDefaultAsync(u => u.Email == "admin@divertiflix.local" && u.Role == Role.Admin);
        if (admin is null)
        {
            admin = new User { Email = login, Role = Role.Admin };
            admin.Profiles.Add(new Profile { Name = "Admin" });
            db.Users.Add(admin);
        }
        admin.Email = login;
        admin.PasswordHash = new PasswordHasher<User>().HashPassword(admin, password);
    }

    /// <summary>
    /// Applique le catalogue de démonstration à chaque nouvelle version de <see cref="DemoCatalog"/> seulement :
    /// les modifications faites ensuite depuis le back-office ne sont jamais écrasées par un redémarrage.
    /// </summary>
    private static async Task SeedDemoCatalogAsync(DivertiflixDbContext db, IConfiguration config)
    {
        var tag = $"v{DemoCatalog.Version}";
        if (await db.AuditLogs.AnyAsync(a => a.Action == "seed.demo" && a.Detail == tag)) return;

        var mediaRoot = MediaEndpoints.Root(config);
        var art = Path.Combine(mediaRoot, "art");
        // Durées réelles des médias générés (tools/demo-media) : la fiche ne ment pas sur la durée.
        var manifest = new Dictionary<string, double>();
        var manifestPath = Path.Combine(mediaRoot, "manifest.json");
        if (File.Exists(manifestPath))
            foreach (var (slug, node) in System.Text.Json.JsonDocument.Parse(File.ReadAllText(manifestPath)).RootElement.EnumerateObject().Select(p => (p.Name, p.Value)))
                if (node.TryGetProperty("seconds", out var sec) && sec.TryGetDouble(out var d)) manifest[slug] = d;
        var existing = await db.Titles.ToListAsync();
        var now = DateTime.UtcNow;
        var i = 0;
        foreach (var e in DemoCatalog.All)
        {
            var t = existing.FirstOrDefault(x => x.ExternalSource == "demo" && x.ExternalId == e.Slug)
                    // Les anciens titres du premier seed (sans source externe) sont adoptés plutôt que dupliqués.
                    ?? existing.FirstOrDefault(x => x.ExternalSource == null && Text.Normalize(x.Name) == Text.Normalize(e.Name));
            if (t is null) { t = new Title(); db.Titles.Add(t); existing.Add(t); }

            t.ExternalSource = "demo"; t.ExternalId = e.Slug;
            t.Name = e.Name; t.Synopsis = e.Synopsis; t.Year = e.Year; t.Kind = e.Kind; t.Genre = e.Genre;
            t.DurationMinutes = e.Stream?.StartsWith("media:", StringComparison.Ordinal) == true && manifest.TryGetValue(e.Slug, out var secs) ? Math.Max(1, (int)Math.Ceiling(secs / 60)) : e.Minutes;
            t.Credits = e.Credits;
            t.Maturity = e.Maturity; t.Rating = e.Rating; t.Director = e.Director; t.Cast = [.. e.Cast]; t.Keywords = [.. e.Keywords];
            t.Author = e.Author; t.Narrator = e.Narrator; t.StreamUrl = e.Stream;
            t.PosterUrl = e.Art && File.Exists(Path.Combine(art, e.Slug, "poster.webp")) ? $"/api/media/art/{e.Slug}/poster.webp" : null;
            t.BackdropUrl = e.Art && File.Exists(Path.Combine(art, e.Slug, "backdrop.webp")) ? $"/api/media/art/{e.Slug}/backdrop.webp" : null;
            t.AddedAt = now.AddDays(-2 * i++);   // échelonné, pour que « Ajouts récents » ait un ordre lisible
            t.RefreshSearchText();
        }
        db.AuditLogs.Add(new AuditLog { Action = "seed.demo", Target = "catalog", Detail = tag });
    }
}
