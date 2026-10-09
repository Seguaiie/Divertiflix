using System.Security.Cryptography;
using System.Text;

namespace Divertiflix.Api.Support;

/// <summary>Contrôle de la clé partagée des synchronisations machine à machine, en temps constant.</summary>
public static class SyncKey
{
    public static bool Valid(string? expected, string? provided)
    {
        if (string.IsNullOrEmpty(expected) || string.IsNullOrEmpty(provided)) return false;
        // Empreintes de même longueur : la comparaison ne dépend ni de la longueur ni du contenu.
        var a = SHA256.HashData(Encoding.UTF8.GetBytes(expected));
        var b = SHA256.HashData(Encoding.UTF8.GetBytes(provided));
        return CryptographicOperations.FixedTimeEquals(a, b);
    }
}
