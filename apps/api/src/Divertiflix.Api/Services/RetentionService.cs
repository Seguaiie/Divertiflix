using Divertiflix.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace Divertiflix.Api.Services;

/// <summary>
/// Rétention des données (Loi 25, minimisation) : jetons expirés ou révoqués, notifications lues, journal d'audit.
/// Passe toutes les heures ; ne bloque jamais le démarrage.
/// </summary>
public sealed class RetentionService(IServiceScopeFactory scopes, ILogger<RetentionService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<DivertiflixDbContext>();
                var now = DateTime.UtcNow;
                var tokens = await db.RefreshTokens.Where(t => t.ExpiresAt < now.AddDays(-1) || (t.RevokedAt != null && t.RevokedAt < now.AddDays(-7))).ExecuteDeleteAsync(stoppingToken);
                var notes = await db.Notifications.Where(n => n.ReadAt != null && n.ReadAt < now.AddDays(-60) || n.CreatedAt < now.AddDays(-180)).ExecuteDeleteAsync(stoppingToken);
                var audit = await db.AuditLogs.Where(a => a.At < now.AddDays(-365)).ExecuteDeleteAsync(stoppingToken);
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
