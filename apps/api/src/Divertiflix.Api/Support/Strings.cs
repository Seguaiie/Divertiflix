namespace Divertiflix.Api.Support;

public static class Strings
{
    /// <summary>Abrège à <paramref name="max"/> caractères sans couper une paire de substitution (Npgsql refuse un demi-caractère).</summary>
    public static string Truncate(this string s, int max) =>
        s.Length <= max ? s : char.IsHighSurrogate(s[max - 1]) ? s[..(max - 1)] : s[..max];
}
