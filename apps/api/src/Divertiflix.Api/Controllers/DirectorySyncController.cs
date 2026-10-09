using Divertiflix.Api.Dtos;
using Divertiflix.Api.Hubs;
using Divertiflix.Api.Services;
using Divertiflix.Api.Support;
using Divertiflix.Domain;
using Divertiflix.Infrastructure;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace Divertiflix.Api.Controllers;

/// <summary>
/// Point d'ingestion pour la synchronisation Active Directory (voir scripts/ad_sync_example.py). Pas de JWT :
/// appelé de machine à machine avec une clé partagée.
/// Garde-fous : un compte local n'est jamais repris (pas d'élévation de privilèges par courriel identique) et une
/// synchronisation qui désactiverait trop de comptes à la fois est refusée, sauf ?force=true.
/// </summary>
[ApiController, Route("api/admin/directory-sync"), EnableRateLimiting("sync")]
public class DirectorySyncController(DivertiflixDbContext db, IConfiguration config, IHubContext<NotificationsHub> hub, Audit audit) : ControllerBase
{
    [HttpPost]
    public async Task<ActionResult<DirectorySyncResult>> Sync(DirectorySyncRequest req, [FromQuery] bool force = false)
    {
        if (!SyncKey.Valid(config["DirectorySync:ApiKey"], Request.Headers["X-Sync-Key"]))
            return this.Err(401, "Clé de synchronisation absente ou invalide (DirectorySync:ApiKey).");

        var adminGroup = config["DirectorySync:AdminGroup"] ?? "Divertiflix-Admins";
        var supportGroup = config["DirectorySync:SupportGroup"] ?? "Divertiflix-Support";
        var maxRatio = config.GetValue<double?>("DirectorySync:MaxDeactivationRatio") ?? 0.5;
        var hasher = new PasswordHasher<User>();

        var accounts = req.Accounts.GroupBy(a => a.Email.Trim().ToLowerInvariant()).Select(g => g.Last()).ToList();
        var seen = accounts.Select(a => a.Email.Trim().ToLowerInvariant()).ToHashSet();
        var existing = await db.Users.Where(u => u.Source == AccountSource.ActiveDirectory).ToListAsync();
        var byEmail = existing.ToDictionary(u => u.Email);
        var local = (await db.Users.Where(u => u.Source == AccountSource.Local && seen.Contains(u.Email)).Select(u => u.Email).ToListAsync()).ToHashSet();

        var toDeactivate = existing.Where(u => u.IsActive && !seen.Contains(u.Email)).ToList();
        var activeAd = existing.Count(u => u.IsActive);
        if (!force && toDeactivate.Count > 0 && toDeactivate.Count > maxRatio * activeAd)
            return this.Err(409, $"Synchronisation refusée : elle désactiverait {toDeactivate.Count} compte(s) sur {activeAd}. Vérifiez la source (annuaire injoignable ?) ou relancez avec ?force=true.");

        int created = 0, updated = 0, conflicts = 0;
        foreach (var acc in accounts)
        {
            var email = acc.Email.Trim().ToLowerInvariant();
            if (local.Contains(email)) { conflicts++; continue; }   // compte local homonyme : on n'y touche pas
            var groups = acc.Groups ?? [];
            var role = groups.Contains(adminGroup) ? Role.Admin : groups.Contains(supportGroup) ? Role.Support : Role.Subscriber;
            if (!byEmail.TryGetValue(email, out var user))
            {
                // Aucune authentification locale réelle tant que le vrai échange AD (Kerberos/LDAP) n'est pas branché.
                user = new User { Email = email, Source = AccountSource.ActiveDirectory };
                user.PasswordHash = hasher.HashPassword(user, Guid.NewGuid().ToString("N"));
                user.Profiles.Add(new Profile { Name = acc.DisplayName.Trim() });
                db.Users.Add(user);
                created++;
            }
            else updated++;
            user.Role = role;
            user.IsActive = true;
            user.DirectorySyncedAt = DateTime.UtcNow;
        }

        var now = DateTime.UtcNow;
        foreach (var user in toDeactivate) user.IsActive = false;
        if (toDeactivate.Count > 0)
        {
            var ids = toDeactivate.Select(u => u.Id).ToList();
            await db.RefreshTokens.Where(t => ids.Contains(t.UserId) && t.RevokedAt == null).ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now));
        }

        audit.Record(null, "directory.sync", "active-directory", $"created={created} updated={updated} deactivated={toDeactivate.Count} conflicts={conflicts}");
        await db.SaveChangesAsync();
        await hub.Clients.Group(NotificationsHub.StaffGroup).SendAsync("directorySynced", new { created, updated, deactivated = toDeactivate.Count, conflicts, at = now });
        return new DirectorySyncResult(created, updated, toDeactivate.Count, conflicts);
    }
}
