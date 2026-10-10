using Microsoft.AspNetCore.SignalR;

namespace Divertiflix.Api.Hubs;

/// <summary>
/// Connexions SignalR ouvertes, par utilisateur. C'est le seul moyen de couper une connexion déjà établie (Abort) quand
/// le compte est désactivé ou change de rôle : le groupe « staff » est rempli à la connexion et sinon durerait jusqu'à l'expiration du jeton.
/// </summary>
public sealed class HubConnections
{
    private readonly Dictionary<Guid, List<HubCallerContext>> _byUser = [];
    private readonly Lock _gate = new();

    public void Track(Guid userId, HubCallerContext connection)
    {
        lock (_gate)
        {
            if (!_byUser.TryGetValue(userId, out var list)) _byUser[userId] = list = [];
            list.Add(connection);
        }
    }

    public void Untrack(Guid userId, string connectionId)
    {
        lock (_gate)
        {
            if (!_byUser.TryGetValue(userId, out var list)) return;
            list.RemoveAll(c => c.ConnectionId == connectionId);
            if (list.Count == 0) _byUser.Remove(userId);
        }
    }

    /// <summary>Coupe toutes les connexions de l'utilisateur ; le client se reconnecte, avec un jeton qui sera revalidé.</summary>
    public void Abort(Guid userId)
    {
        List<HubCallerContext> open;
        lock (_gate) open = _byUser.TryGetValue(userId, out var list) ? [.. list] : [];
        foreach (var connection in open) connection.Abort();
    }
}
