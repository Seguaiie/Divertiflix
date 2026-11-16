namespace Divertiflix.Api.Support;

/// <summary>Ordonne les classifications d'âge pour le contrôle parental par profil. Inconnue ou absente : traitée comme « TP ».</summary>
public static class MaturityRank
{
    private static readonly Dictionary<string, int> Order = new(StringComparer.OrdinalIgnoreCase)
    { ["TP"] = 0, ["8+"] = 1, ["13+"] = 2, ["16+"] = 3, ["18+"] = 4 };

    public static readonly IReadOnlyList<string> Levels = ["TP", "8+", "13+", "16+", "18+"];

    public static int Of(string? maturity) => maturity is not null && Order.TryGetValue(maturity, out var r) ? r : 0;

    /// <summary>Vrai si un profil limité à <paramref name="profileLimit"/> ne doit pas voir un titre classé <paramref name="titleMaturity"/>.</summary>
    public static bool Exceeds(string? titleMaturity, string? profileLimit) => profileLimit is not null && Of(titleMaturity) > Of(profileLimit);
}
