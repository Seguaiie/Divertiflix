using Divertiflix.Api.Media;
using Microsoft.Extensions.Options;

namespace Divertiflix.Api.Services;

/// <summary>
/// Importe périodiquement les livres d'Audiobookshelf dans le catalogue (Audiobookshelf__SyncMinutes, 60 par défaut, 0 = désactivé).
/// Inactif tant que Audiobookshelf__Url et Audiobookshelf__Token ne sont pas fournis. Une panne d'Audiobookshelf est journalisée, jamais fatale.
/// </summary>
public sealed class AudiobookshelfSyncService(IServiceScopeFactory scopes, IOptions<AudiobookshelfOptions> options, ILogger<AudiobookshelfSyncService> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        var o = options.Value;
        if (!o.Configured) { log.LogInformation("Audiobookshelf non configuré : synchronisation automatique inactive."); return; }
        if (o.SyncMinutes <= 0) { log.LogInformation("Synchronisation Audiobookshelf automatique désactivée (SyncMinutes = 0)."); return; }
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(20), stop);   // laisse l'API finir de démarrer
            using var timer = new PeriodicTimer(TimeSpan.FromMinutes(Math.Max(5, o.SyncMinutes)));
            do { await RunOnceAsync(stop); }
            while (await timer.WaitForNextTickAsync(stop));
        }
        catch (OperationCanceledException) { /* arrêt de l'API */ }
    }

    private async Task RunOnceAsync(CancellationToken stop)
    {
        try
        {
            using var scope = scopes.CreateScope();
            var books = await scope.ServiceProvider.GetRequiredService<AudiobookshelfClient>().ListBooksAsync(stop);
            var result = await scope.ServiceProvider.GetRequiredService<AudiobookshelfCatalog>().UpsertAsync(books, stop);
            log.LogInformation("Synchronisation Audiobookshelf : {Created} créés, {Updated} mis à jour.", result.Created, result.Updated);
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested) { throw; }
        catch (Exception ex)
        {
            log.LogWarning(ex, "Synchronisation Audiobookshelf échouée (nouvel essai au prochain passage).");
        }
    }
}
