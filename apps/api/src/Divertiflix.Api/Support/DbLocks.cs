using Divertiflix.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Divertiflix.Api.Support;

public static class DbLocks
{
    /// <summary>
    /// Ouvre une transaction et y prend un verrou consultatif PostgreSQL de clé <paramref name="key"/>, relâché au COMMIT ou au ROLLBACK
    /// (valider avec CommitAsync, ou laisser disposer pour annuler). À prendre AVANT de lire ce qu'on s'apprête à décider (plafond, doublon,
    /// transition d'état) : les écritures simultanées de même clé passent l'une après l'autre et voient chacune le résultat de la précédente.
    /// </summary>
    public static async Task<IDbContextTransaction> BeginLockedAsync(this DivertiflixDbContext db, string key)
    {
        var tx = await db.Database.BeginTransactionAsync();
        try { await db.Database.ExecuteSqlAsync($"SELECT pg_advisory_xact_lock(hashtext({key}))"); }
        catch { await tx.DisposeAsync(); throw; }
        return tx;
    }
}
