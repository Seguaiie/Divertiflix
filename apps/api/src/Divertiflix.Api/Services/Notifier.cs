using System.Text.Json;
using Divertiflix.Api.Dtos;
using Divertiflix.Api.Hubs;
using Divertiflix.Domain;
using Divertiflix.Infrastructure;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace Divertiflix.Api.Services;

/// <summary>Crée une notification persistante et la pousse en direct à l'utilisateur concerné.</summary>
public sealed class Notifier(DivertiflixDbContext db, IHubContext<NotificationsHub> hub, WebPushSender push, ILogger<Notifier> log)
{
    /// <summary>Ajoute la notification au contexte ; l'appelant enregistre, puis appelle <see cref="PushAsync"/>.</summary>
    public Notification Add(Guid userId, string kind, string title, string? body = null, string? link = null)
    {
        var n = new Notification { UserId = userId, Kind = kind, Title = title, Body = body, Link = link };
        db.Notifications.Add(n);
        return n;
    }

    public async Task PushAsync(Notification n)
    {
        await hub.Clients.User(n.UserId.ToString()).SendAsync("notification", new NotificationDto(n.Id, n.Kind, n.Title, n.Body, n.Link, n.CreatedAt, false));
        if (!push.Configured) return;
        try { await PushWebAsync(n); }
        catch (Exception ex) { log.LogDebug(ex, "Notifications infonuagiques non envoyées."); }
    }

    /// <summary>Au mieux : même abonnements morts ou serveur de notification injoignable, la notification principale (ci-dessus) est déjà partie.</summary>
    private async Task PushWebAsync(Notification n)
    {
        var subs = await db.PushSubscriptions.AsNoTracking().Where(s => s.UserId == n.UserId).ToListAsync();
        if (subs.Count == 0) return;
        var payload = JsonSerializer.Serialize(new { title = n.Title, body = n.Body, link = n.Link });
        var gone = new List<Guid>();
        foreach (var s in subs)
            if (await push.SendAsync(s, payload, CancellationToken.None)) gone.Add(s.Id);
        if (gone.Count > 0) await db.PushSubscriptions.Where(s => gone.Contains(s.Id)).ExecuteDeleteAsync();
    }
}
