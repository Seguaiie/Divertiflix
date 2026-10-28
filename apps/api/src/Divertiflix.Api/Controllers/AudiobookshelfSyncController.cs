using Divertiflix.Api.Dtos;
using Divertiflix.Api.Media;
using Divertiflix.Api.Services;
using Divertiflix.Api.Support;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace Divertiflix.Api.Controllers;

/// <summary>
/// Ingestion Audiobookshelf. Deux entrées : le lot poussé par un script externe (même clé partagée que l'annuaire, voir
/// scripts/audiobookshelf_sync_example.py) et la synchronisation que l'API fait elle-même quand Audiobookshelf est configuré.
/// </summary>
[ApiController, Route("api/admin/audiobookshelf-sync"), EnableRateLimiting("sync")]
public class AudiobookshelfSyncController(IConfiguration config, AudiobookshelfCatalog catalog, AudiobookshelfClient abs) : ControllerBase
{
    [HttpPost]
    public async Task<ActionResult<AudiobookshelfSyncResult>> Sync(AudiobookshelfSyncRequest req)
    {
        if (!SyncKey.Valid(config["AudiobookshelfSync:ApiKey"], Request.Headers["X-Sync-Key"]))
            return this.Err(401, "Clé de synchronisation absente ou invalide (AudiobookshelfSync:ApiKey).");
        return await Upsert(req.Items, HttpContext.RequestAborted);
    }

    /// <summary>Bouton « Synchroniser » du back-office : l'API lit elle-même les bibliothèques Audiobookshelf.</summary>
    [HttpPost("run"), Authorize(Roles = "Admin")]
    public async Task<ActionResult<AudiobookshelfSyncResult>> Run(CancellationToken ct)
    {
        if (!abs.Configured) return this.Err(409, "Audiobookshelf n'est pas configuré (Audiobookshelf__Url et Audiobookshelf__Token).");
        List<AudiobookItemDto> books;
        try { books = await abs.ListBooksAsync(ct); }
        catch (Exception ex) when (ex is HttpRequestException or System.Text.Json.JsonException or KeyNotFoundException or InvalidOperationException || (ex is TaskCanceledException && !ct.IsCancellationRequested))
        { return this.Err(502, "Le serveur Audiobookshelf ne répond pas ou a refusé le jeton."); }
        return await Upsert(books, ct);
    }

    private async Task<ActionResult<AudiobookshelfSyncResult>> Upsert(IEnumerable<AudiobookItemDto> items, CancellationToken ct)
    {
        try { return await catalog.UpsertAsync(items, ct); }
        catch (DbUpdateException ex) when (ex.InnerException is Npgsql.PostgresException { SqlState: "23505" })
        { return this.Err(409, "Une synchronisation concurrente est en cours, réessayez."); }
    }
}
