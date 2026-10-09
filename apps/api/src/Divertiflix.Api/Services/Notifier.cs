using Divertiflix.Api.Dtos;
using Divertiflix.Api.Hubs;
using Divertiflix.Domain;
using Divertiflix.Infrastructure;
using Microsoft.AspNetCore.SignalR;

namespace Divertiflix.Api.Services;

/// <summary>Crée une notification persistante et la pousse en direct à l'utilisateur concerné.</summary>
public sealed class Notifier(DivertiflixDbContext db, IHubContext<NotificationsHub> hub)
{
    /// <summary>Ajoute la notification au contexte ; l'appelant enregistre, puis appelle <see cref="PushAsync"/>.</summary>
    public Notification Add(Guid userId, string kind, string title, string? body = null, string? link = null)
    {
        var n = new Notification { UserId = userId, Kind = kind, Title = title, Body = body, Link = link };
        db.Notifications.Add(n);
        return n;
    }

    public Task PushAsync(Notification n) =>
        hub.Clients.User(n.UserId.ToString()).SendAsync("notification", new NotificationDto(n.Id, n.Kind, n.Title, n.Body, n.Link, n.CreatedAt, false));
}
