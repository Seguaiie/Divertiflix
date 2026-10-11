using System.ComponentModel.DataAnnotations;
using Divertiflix.Api.Auth;
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
/// Un compte invalide (courriel inutilisable, ou entrée vide) est ignoré et compté (« errors ») sans faire échouer les autres ; les changements
/// et la révocation des jetons sont enregistrés ensemble ou pas du tout.
/// </summary>
[ApiController, Route("api/admin/directory-sync"), EnableRateLimiting("sync")]
public class DirectorySyncController(DivertiflixDbContext db, IConfiguration config, IHubContext<NotificationsHub> hub, Audit audit, AccountGuard guard) : ControllerBase
{
    private const int MaxEmail = 256, MaxProfileName = 50;   // colonnes Users.Email et Profiles.Name
    private static readonly EmailAddressAttribute EmailFormat = new();

    private static string EmailOf(DirectoryAccountDto a) => (a.Email ?? "").Trim().ToLowerInvariant();
    private static bool UsableEmail(string email) => email.Length is > 0 and <= MaxEmail && EmailFormat.IsValid(email);

    // Nom d'affichage de la colonne (50 caractères) ; à défaut de nom, la partie locale du courriel.
    private static string ProfileName(DirectoryAccountDto a, string email) =>
        (string.IsNullOrWhiteSpace(a.DisplayName) ? email.Split('@')[0] : a.DisplayName.Trim()).Truncate(MaxProfileName);

    [HttpPost]
    public async Task<ActionResult<DirectorySyncResult>> Sync(DirectorySyncRequest req, [FromQuery] bool force = false)
    {
        if (!SyncKey.Valid(config["DirectorySync:ApiKey"], Request.Headers["X-Sync-Key"]))
            return this.Err(401, "Clé de synchronisation absente ou invalide (DirectorySync:ApiKey).");

        var adminGroup = config["DirectorySync:AdminGroup"] ?? "Divertiflix-Admins";
        var supportGroup = config["DirectorySync:SupportGroup"] ?? "Divertiflix-Support";
        var maxRatio = config.GetValue<double?>("DirectorySync:MaxDeactivationRatio") ?? 0.5;
        var hasher = new PasswordHasher<User>();

        // Un élément null (System.Text.Json l'accepte dans la liste) est un compte invalide comme un autre.
        var usable = req.Accounts.Where(a => a is not null && UsableEmail(EmailOf(a))).ToList();
        var errors = req.Accounts.Count - usable.Count;
        var accounts = usable.GroupBy(EmailOf).Select(g => g.Last()).ToList();
        var seen = accounts.Select(EmailOf).ToHashSet();
        var existing = await db.Users.Where(u => u.Source == AccountSource.ActiveDirectory).ToListAsync();
        var byEmail = existing.ToDictionary(u => u.Email);
        // Tout compte qui n'est pas de l'annuaire est local, y compris un ancien compte à la source vide (avant la colonne Source).
        var local = (await db.Users.Where(u => u.Source != AccountSource.ActiveDirectory && seen.Contains(u.Email)).Select(u => u.Email).ToListAsync()).ToHashSet();

        var toDeactivate = existing.Where(u => u.IsActive && !seen.Contains(u.Email)).ToList();
        var activeAd = existing.Count(u => u.IsActive);
        if (!force && toDeactivate.Count > 0 && toDeactivate.Count > maxRatio * activeAd)
            return this.Err(409, $"Synchronisation refusée : elle désactiverait {toDeactivate.Count} compte(s) sur {activeAd}. Vérifiez la source (annuaire injoignable ?) ou relancez avec ?force=true.");

        int created = 0, updated = 0, conflicts = 0;
        var changed = new List<Guid>();   // comptes existants dont le rôle ou l'état change : leurs jetons et connexions en cours sont à revalider
        foreach (var acc in accounts)
        {
            var email = EmailOf(acc);
            if (local.Contains(email)) { conflicts++; continue; }   // compte local homonyme : on n'y touche pas
            var groups = acc.Groups ?? [];
            var role = groups.Contains(adminGroup) ? Role.Admin : groups.Contains(supportGroup) ? Role.Support : Role.Subscriber;
            if (!byEmail.TryGetValue(email, out var user))
            {
                // Aucune authentification locale réelle tant que le vrai échange AD (Kerberos/LDAP) n'est pas branché.
                user = new User { Email = email, Source = AccountSource.ActiveDirectory };
                user.PasswordHash = hasher.HashPassword(user, Guid.NewGuid().ToString("N"));
                user.Profiles.Add(new Profile { Name = ProfileName(acc, email) });
                db.Users.Add(user);
                created++;
            }
            else
            {
                updated++;
                if (user.Role != role || !user.IsActive) changed.Add(user.Id);
            }
            user.Role = role;
            user.IsActive = true;
            user.DirectorySyncedAt = DateTime.UtcNow;
        }

        var now = DateTime.UtcNow;
        foreach (var user in toDeactivate) user.IsActive = false;
        audit.Record(null, "directory.sync", "active-directory", $"created={created} updated={updated} deactivated={toDeactivate.Count} conflicts={conflicts} errors={errors}");
        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            await db.SaveChangesAsync();
            if (toDeactivate.Count > 0)
            {
                var ids = toDeactivate.Select(u => u.Id).ToList();
                await db.RefreshTokens.Where(t => ids.Contains(t.UserId) && t.RevokedAt == null).ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now));
            }
            await tx.CommitAsync();
        }
        foreach (var id in changed.Concat(toDeactivate.Select(u => u.Id))) guard.Changed(id);
        await hub.Clients.Group(NotificationsHub.StaffGroup).SendAsync("directorySynced", new { created, updated, deactivated = toDeactivate.Count, conflicts, errors, at = now });
        return new DirectorySyncResult(created, updated, toDeactivate.Count, conflicts, errors);
    }
}
