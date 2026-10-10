namespace Divertiflix.Api.Auth;

/// <summary>
/// Refus des mots de passe les plus devinables à l'inscription. La longueur minimale (8) reste celle du DTO : on écarte seulement
/// ce qu'un attaquant essaie en premier, sans imposer de règles de composition.
/// </summary>
public static class PasswordPolicy
{
    // Les plus courants parmi ceux de 8 caractères ou plus (les plus courts sont déjà refusés par la longueur minimale).
    private static readonly HashSet<string> Common = new(StringComparer.OrdinalIgnoreCase)
    {
        "password", "password1", "password12", "password123", "password1234", "password!", "p@ssw0rd", "p@ssword", "pa$$word",
        "12345678", "123456789", "1234567890", "12345678910", "123123123", "123456123456", "11111111", "00000000", "87654321", "987654321", "0987654321",
        "qwertyui", "qwertyuiop", "qwerty123", "qwerty1234", "qwerty12", "qwertyuiop123", "1q2w3e4r", "1q2w3e4r5t", "1qaz2wsx", "q1w2e3r4", "zaq12wsx", "qazwsxedc",
        "abcd1234", "abc12345", "abcdefgh", "abcdefg1", "abcde12345", "a1b2c3d4", "asdfghjk", "asdfghjkl", "asdf1234", "zxcvbnm1", "zxcvbnm123", "zxcvbnm,",
        "azertyui", "azertyuiop", "azerty123", "azerty1234", "azerty12", "motdepasse", "motdepasse1", "monmotdepasse", "bonjour1", "bonjour123", "soleil123",
        "iloveyou", "iloveyou1", "iloveyou2", "iloveyou!", "sunshine", "princess", "football", "baseball", "basketball", "superman", "batman123", "trustno1",
        "letmein1", "letmein123", "welcome1", "welcome12", "welcome123", "monkey123", "dragon123", "master123", "shadow123", "michael1", "jennifer", "charlie1",
        "admin123", "admin1234", "administrator", "changeme", "changeme1", "default1", "secret123", "passpass", "pass1234", "pass12345", "login123", "access14",
        "internet", "computer", "starwars", "whatever", "freedom1", "mustang1", "pokemon1", "liverpool", "chocolate", "summer2020", "summer2021", "summer2022",
        "summer2023", "summer2024", "summer2025", "winter2024", "winter2025", "spring2025", "autumn2025", "january2025", "divertiflix", "divertiflix1", "divertiflix123",
    };

    /// <summary>Raison du refus (en français), ou null si le mot de passe est acceptable.</summary>
    public static string? Reject(string password, string email)
    {
        var local = email.Split('@')[0];
        if (password.Equals(email, StringComparison.OrdinalIgnoreCase) || password.Equals(local, StringComparison.OrdinalIgnoreCase))
            return "Le mot de passe ne doit pas être votre courriel.";
        if (password.Distinct().Count() == 1 || Common.Contains(password.Trim()))
            return "Ce mot de passe est trop courant : choisissez-en un moins prévisible.";
        return null;
    }
}
