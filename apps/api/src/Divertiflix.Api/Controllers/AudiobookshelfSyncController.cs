using Divertiflix.Api.Dtos;
using Divertiflix.Api.Hubs;
using Divertiflix.Api.Services;
using Divertiflix.Api.Support;
using Divertiflix.Domain;
using Divertiflix.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace Divertiflix.Api.Controllers;

/// <summary>Ingestion Audiobookshelf (voir scripts/audiobookshelf_sync_example.py). Même clé partagée que l'annuaire.</summary>
[ApiController, Route("api/admin/audiobookshelf-sync"), EnableRateLimiting("sync")]
public class AudiobookshelfSyncController(DivertiflixDbContext db, IConfiguration config, IHubContext<NotificationsHub> hub, CatalogCache cache, Audit audit) : ControllerBase
{
    private const string ExternalSource = "Audiobookshelf";

    [HttpPost]
    public async Task<ActionResult<AudiobookshelfSyncResult>> Sync(AudiobookshelfSyncRequest req)
    {
        if (!SyncKey.Valid(config["AudiobookshelfSync:ApiKey"], Request.Headers["X-Sync-Key"]))
            return this.Err(401, "Clé de synchronisation absente ou invalide (AudiobookshelfSync:ApiKey).");

        var items = req.Items.GroupBy(i => i.ExternalId).Select(g => g.Last()).ToList();   // doublons dans le lot : le dernier gagne
        var ids = items.Select(i => i.ExternalId).ToList();
        var existing = await db.Titles.Where(t => t.ExternalSource == ExternalSource && ids.Contains(t.ExternalId!)).ToDictionaryAsync(t => t.ExternalId!);

        int created = 0, updated = 0;
        foreach (var item in items)
        {
            if (!existing.TryGetValue(item.ExternalId, out var title))
            {
                title = new Title { ExternalSource = ExternalSource, ExternalId = item.ExternalId, Kind = TitleKind.Audiobook };
                db.Titles.Add(title);
                created++;
            }
            else updated++;
            title.Name = item.Name.Trim();
            title.Synopsis = item.Synopsis ?? "";
            title.Author = item.Author;
            title.Narrator = item.Narrator;
            title.DurationMinutes = item.DurationMinutes;
            title.PosterUrl = item.CoverUrl;
            title.StreamUrl = item.StreamUrl;
            title.Genre = string.IsNullOrWhiteSpace(item.Genre) ? "Livre audio" : item.Genre.Trim();
            title.Year = title.Year == 0 ? DateTime.UtcNow.Year : title.Year;
            title.RefreshSearchText();
        }

        audit.Record(null, "audiobookshelf.sync", ExternalSource, $"created={created} updated={updated}");
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException ex) when (ex.InnerException is Npgsql.PostgresException { SqlState: "23505" })
        { return this.Err(409, "Une synchronisation concurrente est en cours, réessayez."); }
        cache.Invalidate();
        await hub.Clients.Group(NotificationsHub.StaffGroup).SendAsync("audiobookshelfSynced", new { created, updated, at = DateTime.UtcNow });
        return new AudiobookshelfSyncResult(created, updated);
    }
}
