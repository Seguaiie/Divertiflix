using System.Text.RegularExpressions;
using Divertiflix.Domain;
using Microsoft.Extensions.Options;
using Novell.Directory.Ldap;

namespace Divertiflix.Api.Auth;

/// <summary>Annuaire Active Directory (section « ActiveDirectory » : ActiveDirectory__Host, ActiveDirectory__Domain… dans .env).</summary>
public sealed class ActiveDirectoryOptions
{
    /// <summary>Contrôleur de domaine, ex. 192.168.6.117.</summary>
    public string Host { get; set; } = "";
    /// <summary>Domaine des comptes (suffixe UPN), ex. ad.home.arpa.</summary>
    public string Domain { get; set; } = "";
    /// <summary>389 (LDAP) ou 636 (LDAPS, avec UseSsl).</summary>
    public int Port { get; set; } = 389;
    /// <summary>LDAPS : le mot de passe ne circule pas en clair. Le certificat du contrôleur doit être reconnu par le serveur (autorité de l'AD installée).</summary>
    public bool UseSsl { get; set; }
    /// <summary>Rôle d'un compte de l'annuaire à sa première connexion.</summary>
    public Role DefaultRole { get; set; } = Role.Admin;
    public int TimeoutSeconds { get; set; } = 5;

    public bool Configured => Host.Length > 0 && Domain.Length > 0;
}

/// <summary>
/// Vérifie un identifiant de l'annuaire par une liaison LDAP au nom de la personne (UPN « nom@domaine ») : aucun compte de service, et le
/// mot de passe n'est ni conservé ni journalisé. Un compte désactivé, verrouillé ou expiré dans l'AD voit sa liaison refusée.
/// </summary>
public partial class ActiveDirectoryAuth(IOptions<ActiveDirectoryOptions> options, ILogger<ActiveDirectoryAuth> log)
{
    private ActiveDirectoryOptions O => options.Value;
    public bool Configured => O.Configured;
    public Role DefaultRole => O.DefaultRole;

    // sAMAccountName : lettres, chiffres, point, tiret, soulignement. Tout le reste est refusé avant d'aller dans une liaison LDAP.
    [GeneratedRegex("^[a-z0-9][a-z0-9._-]{0,63}$")]
    private static partial Regex AccountName();

    /// <summary>
    /// « jdupont », « jdupont@ad.home.arpa » ou « AD\jdupont » → « jdupont@ad.home.arpa » (identité du compte au portail).
    /// Null si l'identifiant n'est pas de ce domaine (ex. un courriel d'un autre domaine : compte local).
    /// </summary>
    public string? Identity(string login)
    {
        if (!Configured) return null;
        var l = login.Trim().ToLowerInvariant();
        var domain = O.Domain.Trim().ToLowerInvariant();
        if (l.Contains('\\')) l = l[(l.LastIndexOf('\\') + 1)..];
        else if (l.Contains('@'))
        {
            if (!l.EndsWith("@" + domain, StringComparison.Ordinal)) return null;
            l = l[..^(domain.Length + 1)];
        }
        return AccountName().IsMatch(l) ? $"{l}@{domain}" : null;
    }

    /// <summary>Vrai : mot de passe accepté par l'AD. Faux : refusé. Null : annuaire injoignable (ce n'est pas un échec de la personne).</summary>
    public virtual async Task<bool?> VerifyAsync(string upn, string password, CancellationToken ct)
    {
        // Un mot de passe vide ferait une liaison anonyme, que l'AD accepte : jamais.
        if (string.IsNullOrEmpty(password)) return false;
        try
        {
            using var conn = new LdapConnection { SecureSocketLayer = O.UseSsl, ConnectionTimeout = O.TimeoutSeconds * 1000 };
            var work = Task.Run(() =>
            {
                conn.Connect(O.Host, O.Port);
                conn.Bind(upn, password);
                return conn.Bound;
            }, ct);
            var done = await Task.WhenAny(work, Task.Delay(TimeSpan.FromSeconds(O.TimeoutSeconds * 2), ct));
            if (done != work) { log.LogWarning("Active Directory {Host}:{Port} : pas de réponse.", O.Host, O.Port); return null; }
            return await work;
        }
        catch (LdapException ex) when (ex.ResultCode == LdapException.InvalidCredentials) { return false; }
        catch (Exception ex) when (ex is LdapException or System.Net.Sockets.SocketException or IOException or TimeoutException
                                   || (ex is OperationCanceledException && !ct.IsCancellationRequested))
        {
            log.LogWarning("Active Directory {Host}:{Port} injoignable : {Error}", O.Host, O.Port, ex.Message);
            return null;
        }
    }
}
