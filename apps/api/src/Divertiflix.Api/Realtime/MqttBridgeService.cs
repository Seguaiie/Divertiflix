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
public class MqttBridgeService(IHubContext<NotificationsHub> hub, IConfiguration config, ILogger<MqttBridgeService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var host = config["Mqtt:Host"] ?? "localhost";
        var port = config.GetValue<int?>("Mqtt:Port") ?? 1883;
        var topic = config["Mqtt:Topic"] ?? "divertiflix/capteurs/#";

        using var client = new MqttClientFactory().CreateMqttClient();
        client.ApplicationMessageReceivedAsync += async e =>
        {
            await hub.Clients.All.SendAsync("sensorMessage", new
            {
                topic = e.ApplicationMessage.Topic,
                payload = e.ApplicationMessage.ConvertPayloadToString(),
                at = DateTime.UtcNow,
            }, stoppingToken);
        };

        var options = new MqttClientOptionsBuilder()
            .WithTcpServer(host, port)
            .WithClientId($"divertiflix-api-{Guid.NewGuid():N}")
            .Build();

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (!client.IsConnected)
                {
                    await client.ConnectAsync(options, stoppingToken);
                    await client.SubscribeAsync(topic, cancellationToken: stoppingToken);
                    logger.LogInformation("MQTT connecté à {Host}:{Port}, abonné à {Topic}.", host, port, topic);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning("MQTT indisponible ({Host}:{Port}) : {Message}", host, port, ex.Message);
            }
            try { await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken); } catch (OperationCanceledException) { }
        }
    }
}
