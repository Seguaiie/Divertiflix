using Divertiflix.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Divertiflix.Tests;

/// <summary>Migrations rejouées sur une base jetable, avec des données d'une version antérieure.</summary>
public class MigrationTests
{
    private static Task InsertUserAsync(DivertiflixDbContext db, string email, bool withSource) => withSource
        ? db.Database.ExecuteSqlAsync($"""INSERT INTO "Users" ("Id", "Email", "PasswordHash", "Role", "Source", "IsActive", "CreatedAt") VALUES ({Guid.NewGuid()}, {email}, 'x', 'Subscriber', '', true, now())""")
        : db.Database.ExecuteSqlAsync($"""INSERT INTO "Users" ("Id", "Email", "PasswordHash", "Role", "CreatedAt") VALUES ({Guid.NewGuid()}, {email}, 'x', 'Subscriber', now())""");

    [Fact]
    public async Task Existing_accounts_end_up_local_never_with_an_empty_source()
    {
        await using var db = new DivertiflixDbContext(new DbContextOptionsBuilder<DivertiflixDbContext>().UseNpgsql(ApiFactory.NewConnectionString()).Options);
        try
        {
            var migrator = db.GetService<IMigrator>();
            await migrator.MigrateAsync("InitialCreate");
            await InsertUserAsync(db, "avant@test.com", withSource: false);   // avant la colonne Source
            await migrator.MigrateAsync("SessionFamilies");
            await InsertUserAsync(db, "heritage@test.com", withSource: true);  // base déjà migrée où la valeur vide a été écrite
            await migrator.MigrateAsync();

            var sources = await db.Database.SqlQuery<string>($"""SELECT "Source" AS "Value" FROM "Users" ORDER BY "Email" """).ToListAsync();
            Assert.Equal(["Local", "Local"], sources);
        }
        finally { await db.Database.EnsureDeletedAsync(); }
    }

    private sealed record TokenRow(Guid Id, Guid FamilyId, DateTime SessionExpiresAt);

    [Fact]
    public async Task Existing_refresh_tokens_each_become_their_own_family_and_keep_a_fresh_absolute_session_end()
    {
        await using var db = new DivertiflixDbContext(new DbContextOptionsBuilder<DivertiflixDbContext>().UseNpgsql(ApiFactory.NewConnectionString()).Options);
        try
        {
            var migrator = db.GetService<IMigrator>();
            await migrator.MigrateAsync("PortalFoundation");   // la migration juste avant les familles de sessions
            var userId = Guid.NewGuid();
            await db.Database.ExecuteSqlAsync($"""INSERT INTO "Users" ("Id", "Email", "PasswordHash", "Role", "Source", "IsActive", "CreatedAt") VALUES ({userId}, 'jetons@test.com', 'x', 'Subscriber', 'Local', true, now())""");
            // Un jeton vivant, un expiré, un révoqué : tous reçoivent leur propre famille (sinon l'identifiant nul commun ferait couper les sessions de tout le monde).
            foreach (var (hash, expires, revoked) in new (string, string, string)[] { ("vivant", "now() + interval '14 days'", "NULL"), ("expire", "now() - interval '1 day'", "NULL"), ("revoque", "now() + interval '14 days'", "now()") })
                await db.Database.ExecuteSqlRawAsync($"""INSERT INTO "RefreshTokens" ("Id", "UserId", "TokenHash", "ExpiresAt", "RevokedAt") VALUES ('{Guid.NewGuid()}', '{userId}', '{hash}', {expires}, {revoked})""");
            await migrator.MigrateAsync("SessionFamilies");

            var rows = await db.Database.SqlQuery<TokenRow>($"""SELECT "Id", "FamilyId", "SessionExpiresAt" FROM "RefreshTokens" """).ToListAsync();
            Assert.Equal(3, rows.Count);
            Assert.All(rows, r => Assert.Equal(r.Id, r.FamilyId));                              // une famille par jeton
            Assert.Equal(3, rows.Select(r => r.FamilyId).Distinct().Count());
            Assert.All(rows, r => Assert.True(r.SessionExpiresAt > DateTime.UtcNow.AddDays(59)));   // et personne n'est déconnecté au déploiement
        }
        finally { await db.Database.EnsureDeletedAsync(); }
    }
}
