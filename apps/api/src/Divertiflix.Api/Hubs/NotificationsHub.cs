using Divertiflix.Api.Auth;
using Divertiflix.Api.Support;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace Divertiflix.Api.Hubs;

/// <summary>
/// Hub temps réel. Tout utilisateur authentifié reçoit ses propres notifications et les nouveaux titres ;
/// les évènements d'exploitation (capteurs, synchronisations, demandes, billets) ne vont qu'au groupe « staff ».
/// Les clients ne font qu'écouter. Une connexion est coupée dès que son compte est désactivé ou change de rôle.
/// </summary>
[Authorize]
public class NotificationsHub(HubConnections connections, AccountGuard accounts) : Hub
{
    public const string StaffGroup = "staff";

    public override async Task OnConnectedAsync()
    {
        var user = Context.User!;
        // Inscrire d'abord, vérifier ensuite : un changement de compte survenu entre l'authentification de la requête
        // et ce point est vu par la vérification, un changement ultérieur coupe la connexion inscrite.
        connections.Track(user.UserId(), Context);
        if (!await accounts.IsCurrentAsync(user)) { Context.Abort(); return; }
        if (user.IsStaff()) await Groups.AddToGroupAsync(Context.ConnectionId, StaffGroup);
        await base.OnConnectedAsync();
    }

    public override Task OnDisconnectedAsync(Exception? exception)
    {
        if (Context.User is { } user) connections.Untrack(user.UserId(), Context.ConnectionId);
        return base.OnDisconnectedAsync(exception);
    }
}
