using Divertiflix.Api.Dtos;
using Divertiflix.Api.Hubs;
using Divertiflix.Domain;
using Divertiflix.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace Divertiflix.Api.Controllers;

/// <summary>
/// Point d'ingestion pour l'intégration Audiobookshelf (point 7 de la préparation : on n'installe
/// pas le serveur Audiobookshelf ici, un script Python interroge son API REST et pousse le résultat
/// ici — voir scripts/audiobookshelf_sync_example.py). Même principe de clé partagée que
/// DirectorySyncController.
/// </summary>
[ApiController, Route("api/admin/audiobookshelf-sync")]
public class AudiobookshelfSyncController(DivertiflixDbContext db, IConfiguration config, IHubContext<NotificationsHub> hub) : ControllerBase
{
    private const string ExternalSource = "Audiobookshelf";

    [HttpPost]
    public async Task<ActionResult<AudiobookshelfSyncResult>> Sync(AudiobookshelfSyncRequest req)
    {
        var expected = config["AudiobookshelfSync:ApiKey"];
        if (string.IsNullOrEmpty(expected) || Request.Headers["X-Sync-Key"] != expected)
            return Unauthorized(new { error = "Clé de synchronisation absente ou invalide (AudiobookshelfSync:ApiKey)." });

        int created = 0, updated = 0;
        foreach (var item in req.Items)
        {
            var title = await db.Titles.FirstOrDefaultAsync(t => t.ExternalSource == ExternalSource && t.ExternalId == item.ExternalId);
            if (title is null)
            {
                title = new Title { ExternalSource = ExternalSource, ExternalId = item.ExternalId, Kind = TitleKind.Audiobook };
                db.Titles.Add(title);
                created++;
            }
            else
            {
                updated++;
            }
            title.Name = item.Name;
            title.Synopsis = item.Synopsis ?? "";
            title.Author = item.Author;
            title.Narrator = item.Narrator;
            title.DurationMinutes = item.DurationMinutes;
            title.PosterUrl = item.CoverUrl;
            title.StreamUrl = item.StreamUrl;
            title.Genre = item.Genre ?? "Livre audio";
            title.Year = title.Year == 0 ? DateTime.UtcNow.Year : title.Year;
        }

        await db.SaveChangesAsync();
        await hub.Clients.All.SendAsync("audiobookshelfSynced", new { created, updated, at = DateTime.UtcNow });
        return new AudiobookshelfSyncResult(created, updated);
    }
}
