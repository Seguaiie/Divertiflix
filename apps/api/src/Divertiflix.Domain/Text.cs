using System.Globalization;
using System.Text;

namespace Divertiflix.Domain;

/// <summary>Normalisation de texte partagée par la recherche, le moteur de recommandation et l'assistant.</summary>
public static class Text
{
    private static readonly HashSet<string> Stop = new(StringComparer.Ordinal)
    {
        "le","la","les","un","une","des","du","de","d","l","et","ou","au","aux","en","dans","sur","sous","par","pour",
        "avec","sans","qui","que","qu","quoi","dont","ce","cet","cette","ces","son","sa","ses","leur","leurs","il","elle",
        "ils","elles","on","nous","vous","je","tu","se","s","y","ne","pas","plus","est","sont","etre","ont","mais","si",
        "the","an","and","or","of","to","in","for","with","is","are","was","it","its","as","at","by","from","that","this",
        "who","his","her","their","ses","entre","vers","apres","avant","comme","tout","tous","tres","fait","fois",
    };

    /// <summary>Minuscules, sans accents ni ponctuation, espaces simples : "L'Été des Œufs" devient "l ete des oeufs".</summary>
    public static string Normalize(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return "";
        var d = s.Replace("œ", "oe").Replace("Œ", "oe").Replace("æ", "ae").Replace("Æ", "ae").Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(d.Length);
        var lastSpace = true;
        foreach (var ch in d)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) == UnicodeCategory.NonSpacingMark) continue;
            if (char.IsLetterOrDigit(ch)) { sb.Append(char.ToLowerInvariant(ch)); lastSpace = false; }
            else if (!lastSpace) { sb.Append(' '); lastSpace = true; }
        }
        return sb.ToString().TrimEnd();
    }

    /// <summary>Radical léger FR/EN : retire le pluriel et le « e » final (« sombres » et « sombre » se rejoignent).</summary>
    public static string Stem(string t)
    {
        if (t.Length > 4 && (t[^1] == 's' || t[^1] == 'x')) t = t[..^1];
        if (t.Length > 4 && t[^1] == 'e') t = t[..^1];
        return t;
    }

    /// <summary>Mots significatifs, normalisés et ramenés à leur radical.</summary>
    public static IEnumerable<string> Tokens(string? s)
    {
        foreach (var raw in Normalize(s).Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            if (raw.Length < 3 && !char.IsDigit(raw[0])) continue;
            if (Stop.Contains(raw)) continue;
            yield return Stem(raw);
        }
    }

    /// <summary>Échappe les jokers LIKE (%, _ et \) pour une recherche littérale.</summary>
    public static string EscapeLike(string s) => s.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
}
