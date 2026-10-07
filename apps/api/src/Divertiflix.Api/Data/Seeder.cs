using Divertiflix.Domain;
using Divertiflix.Infrastructure;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;

namespace Divertiflix.Api.Data;

public static class Seeder
{
    public static async Task SeedAsync(IServiceProvider sp, IConfiguration config)
    {
        var db = sp.GetRequiredService<DivertiflixDbContext>();
        await db.Database.MigrateAsync();

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

        if (!await db.Titles.AnyAsync())
        {
            db.Titles.AddRange(
                new Title { Name = "Big Buck Bunny", Synopsis = "Un lapin géant se venge de trois rongeurs.", Year = 2008, Kind = TitleKind.Movie, Genre = "Animation", DurationMinutes = 10, StreamUrl = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8" },
                new Title { Name = "Sintel", Synopsis = "Une jeune femme cherche son dragon.", Year = 2010, Kind = TitleKind.Movie, Genre = "Animation", DurationMinutes = 15, StreamUrl = "https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8" },
                new Title { Name = "Tears of Steel", Synopsis = "Des guerriers tentent de sauver le monde des robots.", Year = 2012, Kind = TitleKind.Movie, Genre = "Science-fiction", DurationMinutes = 12 },
                new Title { Name = "Cosmos Laundromat", Synopsis = "Un mouton suicidaire rencontre un vendeur étrange.", Year = 2015, Kind = TitleKind.Movie, Genre = "Fantastique", DurationMinutes = 12 });
        }
        await db.SaveChangesAsync();
    }
}
