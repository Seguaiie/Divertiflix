using Divertiflix.Api.Data;
using Divertiflix.Api.Services;
using Divertiflix.Domain;
using Divertiflix.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Divertiflix.Tests;

public class RetentionTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Old_audit_entries_are_purged_but_the_demo_catalog_marker_is_kept_so_restarts_never_overwrite_admin_edits()
    {
        f.CreateClient();   // démarre l'API : le seed a posé le marqueur
        using var scope = f.Services.CreateScope();
        var sp = scope.ServiceProvider;
        var db = sp.GetRequiredService<DivertiflixDbContext>();

        // Un an plus tard : une modification faite depuis le back-office, et un journal vieux de 400 jours (marqueur compris).
        var sintel = await db.Titles.FirstAsync(t => t.ExternalSource == "demo" && t.Name == "Sintel");
        sintel.Name = "Sintel (modifié par l'admin)";
        db.AuditLogs.Add(new AuditLog { Action = "user.update", Target = "ancien", At = DateTime.UtcNow.AddDays(-400) });
        await db.SaveChangesAsync();
        await db.AuditLogs.Where(a => a.Action == Seeder.DemoMarkerAction).ExecuteUpdateAsync(s => s.SetProperty(a => a.At, DateTime.UtcNow.AddDays(-400)));

        var purged = await RetentionService.PurgeAsync(db, DateTime.UtcNow, default);
        Assert.True(purged.Audit >= 1);
        Assert.False(await db.AuditLogs.AnyAsync(a => a.Action == "user.update" && a.Target == "ancien"));
        Assert.True(await db.AuditLogs.AnyAsync(a => a.Action == Seeder.DemoMarkerAction));

        // « Redémarrage » : le seed voit toujours le marqueur et ne touche à rien.
        db.ChangeTracker.Clear();
        await Seeder.SeedAsync(sp, sp.GetRequiredService<IConfiguration>());
        Assert.Equal("Sintel (modifié par l'admin)", (await db.Titles.AsNoTracking().FirstAsync(t => t.Id == sintel.Id)).Name);
    }
}
