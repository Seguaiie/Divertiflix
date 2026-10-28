using Divertiflix.Api.Dtos;
using Divertiflix.Api.Hubs;
using Divertiflix.Api.Media;
using Divertiflix.Domain;
using Divertiflix.Infrastructure;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace Divertiflix.Api.Services;

/// <summary>Enregistre les livres audio d'Audiobookshelf dans le catalogue : partagé par l'ingestion à clé, le bouton du back-office et la synchronisation périodique.</summary>
public class AudiobookshelfCatalog(DivertiflixDbContext db, IHubContext<NotificationsHub> hub, CatalogCache cache, Audit audit)
{
    private const string ExternalSource = AudiobookshelfClient.Source;

    /// <summary>Crée ou met à jour les titres (clé : source + identifiant externe). Peut lever DbUpdateException si une synchronisation concurrente a inséré le même livre.</summary>
    public async Task<AudiobookshelfSyncResult> UpsertAsync(IEnumerable<AudiobookItemDto> source, CancellationToken ct = default)
    {
        var items = source.GroupBy(i => i.ExternalId).Select(g => g.Last()).ToList();   // doublons dans le lot : le dernier gagne
        var ids = items.Select(i => i.ExternalId).ToList();
        var existing = await db.Titles.Where(t => t.ExternalSource == ExternalSource && ids.Contains(t.ExternalId!)).ToDictionaryAsync(t => t.ExternalId!, ct);

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
        await db.SaveChangesAsync(ct);
        cache.Invalidate();
        await hub.Clients.Group(NotificationsHub.StaffGroup).SendAsync("audiobookshelfSynced", new { created, updated, at = DateTime.UtcNow }, ct);
        return new AudiobookshelfSyncResult(created, updated);
    }
}
