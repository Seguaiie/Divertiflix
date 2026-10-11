using Divertiflix.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Divertiflix.Api.Support;

public static class DbLocks
{
    // Un portier par clé, dans le processus : l'attente se fait ici, sans connexion du pool ni transaction (une rafale d'écritures
    // sur le même verrou épuiserait sinon le pool, puis PostgreSQL). On suppose une seule instance d'API ; le verrou PostgreSQL
    // pris ensuite reste pour la sûreté entre instances. Un portier sans personne dedans est retiré.
    private sealed class Gate { public readonly SemaphoreSlim Turn = new(1, 1); public int Users; }
    private static readonly Dictionary<string, Gate> Gates = [];
    private static readonly Lock GatesLock = new();

    /// <summary>
    /// Attend son tour pour la clé <paramref name="key"/> (dans le processus, sans connexion), puis ouvre une transaction et y prend un verrou
    /// consultatif PostgreSQL de même clé, relâché au COMMIT ou au ROLLBACK (valider avec CommitAsync, ou laisser disposer pour annuler :
    /// le tour est rendu après la transaction). À prendre AVANT de lire ce qu'on s'apprête à décider (plafond, doublon, transition d'état) :
    /// les écritures simultanées de même clé passent l'une après l'autre et voient chacune le résultat de la précédente.
    /// </summary>
    public static async Task<LockedTransaction> BeginLockedAsync(this DivertiflixDbContext db, string key, CancellationToken ct = default)
    {
        Gate gate;
        lock (GatesLock)
        {
            if (!Gates.TryGetValue(key, out gate!)) Gates[key] = gate = new Gate();
            gate.Users++;
        }
        var held = false;
        try
        {
            await gate.Turn.WaitAsync(ct);
            held = true;
            var tx = await db.Database.BeginTransactionAsync(ct);
            try { await db.Database.ExecuteSqlAsync($"SELECT pg_advisory_xact_lock(hashtext({key}))", ct); }
            catch { await tx.DisposeAsync(); throw; }
            return new LockedTransaction(tx, () => Leave(key, gate, held: true));
        }
        catch
        {
            Leave(key, gate, held);
            throw;
        }
    }

    // Rend le tour s'il a été obtenu (un appel annulé pendant l'attente n'a rien à rendre), puis retire le portier s'il est vide.
    private static void Leave(string key, Gate gate, bool held)
    {
        if (held) gate.Turn.Release();
        lock (GatesLock) if (--gate.Users == 0) Gates.Remove(key);
    }
}

/// <summary>
/// Transaction tenue sous un verrou (voir <see cref="DbLocks.BeginLockedAsync"/>). Le tour est rendu après le verrou PostgreSQL, dans l'ordre inverse
/// de la prise : à la validation, ou à la disposition (qui annule si rien n'a été validé).
/// </summary>
public sealed class LockedTransaction(IDbContextTransaction tx, Action leave) : IAsyncDisposable
{
    private Action? _leave = leave;

    public async Task CommitAsync(CancellationToken ct = default)
    {
        await tx.CommitAsync(ct);
        Leave();
    }

    public async ValueTask DisposeAsync()
    {
        try { await tx.DisposeAsync(); }
        finally { Leave(); }
    }

    private void Leave() => Interlocked.Exchange(ref _leave, null)?.Invoke();
}
