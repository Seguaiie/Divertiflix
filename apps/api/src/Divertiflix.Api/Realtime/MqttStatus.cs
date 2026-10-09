namespace Divertiflix.Api.Realtime;

/// <summary>État de la liaison MQTT, lu par /api/status.</summary>
public sealed class MqttStatus
{
    private volatile bool _connected;
    public bool Connected { get => _connected; set => _connected = value; }
    public DateTime? LastMessageAt { get; set; }
}
