using Divertiflix.Api.Hubs;
using Microsoft.AspNetCore.SignalR;
using MQTTnet;

namespace Divertiflix.Api.Realtime;

/// <summary>
/// Pont MQTT -> SignalR (étape 4, plan.md) : s'abonne aux capteurs ESP32 publiés sur Mosquitto
/// (docker-compose, port 1883) et republie chaque message vers les clients SignalR connectés.
/// Pas de vrai ESP32 nécessaire pour tester : simuler avec
///   mosquitto_pub -h localhost -t divertiflix/capteurs/temp1 -m '{"temp":21.5}'
/// Se reconnecte tout seul ; ne bloque jamais le démarrage de l'API si Mosquitto est indisponible.
/// </summary>
public class MqttBridgeService(IHubContext<NotificationsHub> hub, IConfiguration config, ILogger<MqttBridgeService> logger, MqttStatus status) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var host = config["Mqtt:Host"] ?? "localhost";
        var port = config.GetValue<int?>("Mqtt:Port") ?? 1883;
        var topic = config["Mqtt:Topic"] ?? "divertiflix/capteurs/#";

        using var client = new MqttClientFactory().CreateMqttClient();
        client.ApplicationMessageReceivedAsync += async e =>
        {
            status.LastMessageAt = DateTime.UtcNow;
            var payload = e.ApplicationMessage.ConvertPayloadToString() ?? "";
            if (payload.Length > 2000) payload = payload[..2000];   // un capteur bavard ne doit pas saturer les clients
            await hub.Clients.Group(NotificationsHub.StaffGroup).SendAsync("sensorMessage", new
            {
                topic = e.ApplicationMessage.Topic,
                payload,
                at = DateTime.UtcNow,
            }, stoppingToken);
        };

        var builder = new MqttClientOptionsBuilder()
            .WithTcpServer(host, port)
            .WithClientId($"divertiflix-api-{Guid.NewGuid():N}");
        // Mosquitto durci (password_file) : identifiants optionnels, jamais en dur.
        if (config["Mqtt:User"] is { Length: > 0 } user) builder = builder.WithCredentials(user, config["Mqtt:Password"]);
        var options = builder.Build();
        client.DisconnectedAsync += _ => { status.Connected = false; return Task.CompletedTask; };

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (!client.IsConnected)
                {
                    await client.ConnectAsync(options, stoppingToken);
                    await client.SubscribeAsync(topic, cancellationToken: stoppingToken);
                    status.Connected = true;
                    logger.LogInformation("MQTT connecté à {Host}:{Port}, abonné à {Topic}.", host, port, topic);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // Connecté mais pas abonné serait un état muet : on repart d'une connexion propre.
                status.Connected = false;
                if (client.IsConnected) { try { await client.DisconnectAsync(cancellationToken: stoppingToken); } catch { /* déjà fermé */ } }
                logger.LogWarning("MQTT indisponible ({Host}:{Port}) : {Message}", host, port, ex.Message);
            }
            try { await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken); } catch (OperationCanceledException) { }
        }
    }
}
