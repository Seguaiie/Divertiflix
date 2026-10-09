using Divertiflix.Api.Dtos;
using Divertiflix.Api.Hubs;
using Divertiflix.Domain;
using Divertiflix.Infrastructure;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace Divertiflix.Api.Controllers;

/// <summary>
/// Point d'ingestion pour la synchronisation Active Directory (point 6 de la préparation : pas de
/// serveur Windows/LDAP ici, cette info arrivera d'un script Python tournant sur une machine du
/// domaine — voir scripts/ad_sync_example.py). Pas de JWT : appelé machine-à-machine avec une clé
/// partagée, comme AudiobookshelfSyncController.
/// </summary>
[ApiController, Route("api/admin/directory-sync")]
public class DirectorySyncController(DivertiflixDbContext db, IConfiguration config, IHubContext<NotificationsHub> hub) : ControllerBase
{
    [HttpPost]
    public async Task<ActionResult<DirectorySyncResult>> Sync(DirectorySyncRequest req)
    {
        var expected = config["DirectorySync:ApiKey"];
        if (string.IsNullOrEmpty(expected) || Request.Headers["X-Sync-Key"] != expected)
            return Unauthorized(new { error = "Clé de synchronisation absente ou invalide (DirectorySync:ApiKey)." });

        var adminGroup = config["DirectorySync:AdminGroup"] ?? "Divertiflix-Admins";
        var supportGroup = config["DirectorySync:SupportGroup"] ?? "Divertiflix-Support";
        var hasher = new PasswordHasher<User>();

        var seenEmails = req.Accounts.Select(a => a.Email.Trim().ToLowerInvariant()).ToHashSet();
        var existing = await db.Users.Where(u => u.Source == AccountSource.ActiveDirectory).ToListAsync();
        int created = 0, updated = 0;

        foreach (var acc in req.Accounts)
        {
            var email = acc.Email.Trim().ToLowerInvariant();
            var role = acc.Groups.Contains(adminGroup) ? Role.Admin
                     : acc.Groups.Contains(supportGroup) ? Role.Support
                     : Role.Subscriber;
            var user = existing.FirstOrDefault(u => u.Email == email) ?? await db.Users.FirstOrDefaultAsync(u => u.Email == email);
            if (user is null)
            {
                // Compte créé depuis l'AD : aucune authentification locale réelle tant que le
                // vrai échange AD (Kerberos/LDAP bind côté script) n'est pas branché sur /api/auth/login.
                user = new User { Email = email, Source = AccountSource.ActiveDirectory };
                user.PasswordHash = hasher.HashPassword(user, Guid.NewGuid().ToString("N"));
                user.Profiles.Add(new Profile { Name = acc.DisplayName });
                db.Users.Add(user);
                created++;
            }
            else
            {
                updated++;
            }
            user.Role = role;
            user.Source = AccountSource.ActiveDirectory;
            user.IsActive = true;
            user.DirectorySyncedAt = DateTime.UtcNow;
        }

        // Désactive (sans supprimer) les comptes AD qui ne sont plus dans l'annuaire.
        var deactivated = 0;
        foreach (var user in existing)
        {
            if (!seenEmails.Contains(user.Email) && user.IsActive)
            {
                user.IsActive = false;
                deactivated++;
            }
        }

        await db.SaveChangesAsync();
        await hub.Clients.All.SendAsync("directorySynced", new { created, updated, deactivated, at = DateTime.UtcNow });
        return new DirectorySyncResult(created, updated, deactivated);
    }
}
