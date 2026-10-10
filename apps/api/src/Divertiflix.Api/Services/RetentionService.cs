using Divertiflix.Api.Data;
using Divertiflix.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace Divertiflix.Api.Services;

/// <summary>
/// Rétention des données (Loi 25, minimisation) : jetons expirés ou révoqués, notifications lues, journal d'audit.
/// Passe toutes les heures ; ne bloque jamais le démarrage.
/// </summary>
public sealed class RetentionService(IServiceScopeFactory scopes, ILogger<RetentionService> logger) : BackgroundService
{
    /// <summary>Une passe de purge. Le marqueur du catalogue de démo reste : sans lui, un redémarrage rejouerait le seed et écraserait le back-office.</summary>
    public static async Task<(int Tokens, int Notes, int Audit)> PurgeAsync(DivertiflixDbContext db, DateTime now, CancellationToken ct)
    {
        var tokens = await db.RefreshTokens.Where(t => t.ExpiresAt < now.AddDays(-1) || (t.RevokedAt != null && t.RevokedAt < now.AddDays(-7))).ExecuteDeleteAsync(ct);
        var notes = await db.Notifications.Where(n => n.ReadAt != null && n.ReadAt < now.AddDays(-60) || n.CreatedAt < now.AddDays(-180)).ExecuteDeleteAsync(ct);
        var audit = await db.AuditLogs.Where(a => a.At < now.AddDays(-365) && a.Action != Seeder.DemoMarkerAction).ExecuteDeleteAsync(ct);
        return (tokens, notes, audit);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<DivertiflixDbContext>();
                var (tokens, notes, audit) = await PurgeAsync(db, DateTime.UtcNow, stoppingToken);
                if (tokens + notes + audit > 0) logger.LogInformation("Rétention : {Tokens} jetons, {Notes} notifications, {Audit} entrées d'audit purgés.", tokens, notes, audit);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Passe de rétention ignorée.");
            }
            try { await Task.Delay(TimeSpan.FromHours(1), stoppingToken); } catch (OperationCanceledException) { }
        }
    }
}
