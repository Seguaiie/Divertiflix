using System.Security.Claims;
using Divertiflix.Api.Hubs;
using Divertiflix.Api.Support;
using Divertiflix.Domain;
using Divertiflix.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace Divertiflix.Api.Auth;

/// <summary>Ce que l'API fait respecter d'un compte : actif ou non, et rôle courant.</summary>
public sealed record AccountState(bool IsActive, Role Role);

/// <summary>
/// Revalide le compte derrière un jeton : le JWT embarque le rôle et vit 15 minutes, il ne peut donc pas être cru seul
/// (un compte désactivé ou rétrogradé garderait ses droits, et pourrait se les rendre). Singleton à cache mémoire de quelques
/// secondes : une requête authentifiée coûte au plus une lecture par utilisateur et par fenêtre. Les écritures (administration,
/// synchronisation d'annuaire) appellent <see cref="Changed"/> : le cache est vidé et les connexions temps réel sont coupées sur le champ.
/// </summary>
public sealed class AccountGuard(IServiceScopeFactory scopes, IMemoryCache cache, HubConnections hubs)
{
    private static readonly TimeSpan Ttl = TimeSpan.FromSeconds(5);
    private long _epoch;   // compte les changements : une lecture qui chevauche un changement n'est pas retenue

    private static string Key(Guid userId) => $"account:{userId:N}";

    /// <summary>État du compte, ou null s'il n'existe plus.</summary>
    public async Task<AccountState?> GetAsync(Guid userId)
    {
        var key = Key(userId);
        if (cache.TryGetValue(key, out AccountState? known)) return known;
        var epoch = Interlocked.Read(ref _epoch);
        AccountState? state;
        await using (var scope = scopes.CreateAsyncScope())
            state = await scope.ServiceProvider.GetRequiredService<DivertiflixDbContext>().Users.AsNoTracking()
                .Where(u => u.Id == userId).Select(u => new AccountState(u.IsActive, u.Role)).FirstOrDefaultAsync();
        // Sans cette garde, une lecture commencée avant l'écriture d'un administrateur pourrait remettre l'ancien état en cache juste après son invalidation.
        if (epoch == Interlocked.Read(ref _epoch)) cache.Set(key, state, Ttl);
        return state;
    }

    public async Task<bool> IsActiveAsync(Guid userId) => await GetAsync(userId) is { IsActive: true };

    /// <summary>Un jeton vaut tant que son compte est actif et que son rôle est celui qu'il annonce.</summary>
    public async Task<bool> IsCurrentAsync(ClaimsPrincipal user) =>
        user.TryUserId(out var id) && await GetAsync(id) is { IsActive: true } state && user.FindFirstValue(ClaimTypes.Role) == state.Role.ToString();

    /// <summary>Le compte vient de changer (rôle, état) : oublie l'état connu et coupe les connexions temps réel de l'utilisateur.</summary>
    public void Changed(Guid userId)
    {
        Interlocked.Increment(ref _epoch);
        cache.Remove(Key(userId));
        hubs.Abort(userId);
    }
}
