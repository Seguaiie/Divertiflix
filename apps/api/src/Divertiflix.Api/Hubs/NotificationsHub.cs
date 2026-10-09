using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace Divertiflix.Api.Hubs;

/// <summary>
/// Hub de notifications temps réel (étape 4 du plan) : pousse les évènements serveur → clients
/// (nouveaux titres, synchros AD/Audiobookshelf, messages capteurs ESP32 via MqttBridgeService).
/// Les clients ne font qu'écouter ; aucune méthode cliente → serveur pour l'instant.
/// </summary>
[Authorize]
public class NotificationsHub : Hub;
