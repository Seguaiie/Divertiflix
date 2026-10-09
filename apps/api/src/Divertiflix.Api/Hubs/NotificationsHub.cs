using Divertiflix.Api.Support;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace Divertiflix.Api.Hubs;

/// <summary>
/// Hub temps réel. Tout utilisateur authentifié reçoit ses propres notifications et les nouveaux titres ;
/// les évènements d'exploitation (capteurs, synchronisations, demandes, billets) ne vont qu'au groupe « staff ».
/// Les clients ne font qu'écouter.
/// </summary>
[Authorize]
public class NotificationsHub : Hub
{
    public const string StaffGroup = "staff";

    public override async Task OnConnectedAsync()
    {
        if (Context.User?.IsStaff() == true) await Groups.AddToGroupAsync(Context.ConnectionId, StaffGroup);
        await base.OnConnectedAsync();
    }
}
