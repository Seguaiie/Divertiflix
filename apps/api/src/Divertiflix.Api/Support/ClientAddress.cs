using System.Net;
using System.Net.Sockets;

namespace Divertiflix.Api.Support;

public static class ClientAddress
{
    /// <summary>
    /// Clé de limitation d'un client : l'adresse IPv4, ou le préfixe /64 en IPv6 (un abonné y contrôle 2^64 adresses : limiter
    /// l'adresse complète ne limiterait rien). Une IPv4 reçue sous forme IPv6 (::ffff:a.b.c.d) redevient une IPv4.
    /// </summary>
    public static string Key(IPAddress? ip)
    {
        if (ip is null) return "unknown";
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (ip.AddressFamily != AddressFamily.InterNetworkV6) return ip.ToString();
        Span<byte> bytes = stackalloc byte[16];
        ip.TryWriteBytes(bytes, out _);
        bytes[8..].Clear();
        return new IPAddress(bytes).ToString() + "/64";
    }
}
