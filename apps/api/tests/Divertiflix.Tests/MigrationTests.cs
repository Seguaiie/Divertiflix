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
}
